// LANDING-2 · the Resources menu: guides, templates, articles, the glossary,
// the FAQ, help, what's new, the three calculators and the legal drafts.
import React, { useState } from "react";
import { Hero, Crumbs, Cards, FaqS, FinalCta, StatBand, Steps, Photo, Pill, A, Cover, rich } from "../lib";
import { GUIDES, GUIDE_SLUGS } from "../data/guides";
import { TEMPL } from "../data/templates";
import { ARTS } from "../data/articles";
import { API } from "../../api";
import { PRODUCT_WORDS } from "../../../../shared/changelog.js";
import { HELP_ARTICLES } from "../../../../shared/helpArticles.js";
import { searchArticles } from "../../../../shared/helpSearch.js";
// TRUST-2: What's new is the files in docs/changelog/, one per build, never
// generated from commit messages. A super-admin can hide an entry.
import { CHANGELOG } from "../../lib/changelog";
import { ART2, ART2_SLUGS } from "../data/articles2";
import { GLOSS } from "../data/glossary";
import { FAQ_PAGE } from "../data/faqs";
import { SRC, SRC_ALL, QUOTES } from "../data/research";
import { useLocation } from "react-router-dom";
import PRICING from "../../../../pricing.json";
import { SOURCES, SOURCE_KEYS, RETENTION_GAP, checkedOn } from "../../../../shared/sources.js";
import { LEGAL_ENTITY_NAME } from "../../../../shared/legalEntity.js";

// FIX-13 · the page runs the audit. It used to promise "run the free audit"
// and "drop it in" with nothing to drop a file on: the working audit lived
// only at /lost-and-found. Now this page renders that same component, so the
// drop zone and the Run the free audit button sit in the hero, and every
// Lost & Found link on the site (menu, tools, feature finder) lands on a page
// that can run it. Book a demo and Start free stay below the result.
// Lazy, so the audit's code loads only for the people who come here.
const LostAndFoundAudit = React.lazy(() => import("../../pages/LostAndFound").then(m => ({ default: m.LostAndFoundAudit })));

export function Resources() {
  return <>
    <Hero eyebrow="Resources" crumbs={[["Resources"]]} h="Learn from people <b>who've done the work.</b>" lede="Guides, templates, free tools and the research behind them, for development teams of one to five." noCta />
    <Cards list={[["/guides", "Guides", "Five plans you can run this month.", "forms"], ["/templates", "Templates", "Thank-you letters, win-back emails and more.", "receipts"], ["/articles", "Articles", "Short reads on retention and stewardship.", "grants"], ["/glossary", "Glossary", "Fundraising terms in plain words.", "forms"], ["/tools", "Free tools", "Lost & Found and three calculators.", "reports"], ["/faq", "FAQ", "Answers to what most teams ask first.", "check"], ["/research", "Research", "Every number on this site, with its source.", "audit"]]} />
    <StatBand n={4} dark />
    <FinalCta />
  </>;
}

export function Guides() {
  return <>
    <Hero eyebrow="Guides" crumbs={[["Resources", "/resources"], ["Guides"]]} h="Practical guides <b>for small teams.</b>" lede="Plans you can run this month, written for a development office of one to five people." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="res">
      {GUIDE_SLUGS.map(k => {
        const g = GUIDES[k];
        return <A className="rc" href={"/guides/" + k} key={k}><Photo k={g.p} /><span className="k">Guide · {g.min} min</span><h4>{g.t}</h4><p>{g.d}</p><span className="go">Read the guide →</span></A>;
      })}
    </div></div></section>
    <FinalCta />
  </>;
}

function jump(e, id) {
  e.preventDefault();
  const t = document.getElementById(id);
  if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
}

export function Guide({ slug }) {
  const g = GUIDES[slug];
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Guides", "/guides"], [g.t]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap hero-g">
      <div><div className="eyebrow">Guide · {g.min} minute read</div><h1 className="mix h-l">{g.t}</h1><p className="lede">{g.d}</p></div>
      <Photo k={g.p} cls="wide" eager />
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap art-g">
      <aside className="toc"><b>In this guide</b>{g.s.map((s, i) => <a key={i} href={"#g" + i} onClick={e => jump(e, "g" + i)}>{s[0]}</a>)}</aside>
      <article className="prose">
        {g.s.map((s, i) => <React.Fragment key={i}><h2 id={"g" + i}>{s[0]}</h2><p>{s[1]}</p></React.Fragment>)}
        {g.src && <p className="srcnote">Sources: {g.src.map((k, n) => <React.Fragment key={k}>{n ? " · " : ""}<A href={SRC_ALL[k][1]}>{SRC_ALL[k][0]}</A></React.Fragment>)}</p>}
        <div className="callout"><b>Run this plan in Steward.</b><p>Journeys schedule every touch, name who owns it and put today's steps on your Home screen.</p><Pill href="/demo">Book a demo</Pill></div>
      </article>
    </div></section>
    <Cards eb="More guides" h="Keep <b>reading.</b>" list={GUIDE_SLUGS.filter(x => x !== slug).slice(0, 3).map(x => ["/guides/" + x, GUIDES[x].t, GUIDES[x].d, "forms"])} />
    <FinalCta />
  </>;
}

function Template({ t }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try { navigator.clipboard.writeText(t[1]); setCopied(true); } catch { /* the text stays selectable */ }
  }
  return (
    <div className="tmpl">
      <div className="th"><h4>{t[0]}</h4><button className="pill pill-soft" type="button" onClick={copy}><i></i>{copied ? "Copied" : "Copy"}</button></div>
      <pre>{t[1]}</pre>
    </div>
  );
}

export function Templates() {
  return <>
    <Hero eyebrow="Templates" crumbs={[["Resources", "/resources"], ["Templates"]]} h="Templates you can <b>use today.</b>" lede="Copy, adapt and send. Every template is free." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tmpls">{TEMPL.map(t => <Template t={t} key={t[0]} />)}</div></section>
    <FinalCta />
  </>;
}

// LANDING-3 · article cards wear a generated cover, never a photograph: an
// ink, emerald or tint block with a serif title and a leaf. They cost nothing
// to load and stay legible at any size.
export function ArtCards({ keys }) {
  return (
    <div className="res">
      {keys.map((k, i) => {
        if (k === "state-of-retention") return (
          <A className="rc" href="/articles/state-of-retention" key={k}>
            <Cover t="The state of" b="donor retention" i={i} />
            <span className="k">Research</span>
            <h4>The state of donor retention, in plain words</h4>
            <p>What the latest sector data says about who gives again.</p>
            <span className="go">Read →</span>
          </A>
        );
        const a = ART2[k];
        return (
          <A className="rc" href={"/articles/" + k} key={k}>
            <Cover t={a.t} b={a.b} i={i} />
            <span className="k">{a.k} · {a.min} min</span>
            <h4>{plainH(a.h)}</h4><p>{a.d}</p>
            <span className="go">Read →</span>
          </A>
        );
      })}
    </div>
  );
}

const plainH = h => h.replace(/<\/?b>/g, "");

export function Articles() {
  return <>
    <Hero eyebrow="Articles" crumbs={[["Resources", "/resources"], ["Articles"]]} h="Ideas worth <b>a coffee break.</b>" lede="Short reads on retention, stewardship and running a calm development office." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><ArtCards keys={ART2_SLUGS} /></div></section>
    <FinalCta />
  </>;
}

// The one template for the six new articles.
export function Article({ slug }) {
  const a = ART2[slug];
  const i = ART2_SLUGS.indexOf(slug);
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Articles", "/articles"], [plainH(a.h)]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap hero-g">
      <div>
        <div className="eyebrow">{a.k} · {a.min} minute read</div>
        <h1 className="mix h-l">{rich(a.h)}</h1>
        <p className="lede">{a.d}</p>
      </div>
      <Cover t={a.t} b={a.b} i={i} />
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap prose narrow">
      <p>{a.lede}</p>
      {a.s.map(([h, ps]) => <React.Fragment key={h}><h2>{h}</h2>{ps.map(x => <p key={x}>{x}</p>)}</React.Fragment>)}
      {a.src && <p className="srcnote">Source: {a.src.map((k, n) => <React.Fragment key={k}>{n ? " · " : ""}<A href={SRC_ALL[k][1]}>{SRC_ALL[k][0]}</A></React.Fragment>)}</p>}
      {a.end === "lost-and-found"
        ? <div className="callout"><b>Start with week one, today.</b><p>The free Lost & Found audit shows who is slipping from a giving export. It runs in your browser and nothing is uploaded. Then bring the same file to a 20-minute demo.</p><div className="ctas" style={{ marginTop: 6 }}><Pill href="/tools/lost-and-found">Run the free audit</Pill><Pill kind="soft" href="/demo">Book a demo</Pill></div></div>
        : <div className="callout"><b>See it in Steward.</b><p>Bring your own file to a 20-minute demo.</p><Pill href="/demo">Book a demo</Pill></div>}
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">Keep reading</div>
      <ArtCards keys={ART2_SLUGS.filter(x => x !== slug).slice(0, 3)} />
    </div></section>
    <FinalCta />
  </>;
}

// A research quote inside an article, with its source. LANDING-3 deleted this
// while the two calls below stayed, and the article threw on render (PROOF-2).
const srcShortOf = k => SRC[k][0].split(",")[0];
const Quote = ({ q }) => <blockquote data-quote="research">{q[0]}<cite>{q[1]}, {q[2]} · <A href={SRC[q[3]][1]}>{srcShortOf(q[3])}</A></cite></blockquote>;

export function StateOfRetention() {
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Articles", "/articles"], ["The state of donor retention"]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap">
      <div className="eyebrow">Article · 5 minute read</div>
      <h1 className="mix h-l" style={{ maxWidth: 1000 }}>The state of donor retention, <b>in plain words.</b></h1>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap prose narrow">
      <p>Every quarter the Fundraising Effectiveness Project, a collaboration of AFP and GivingTuesday, publishes giving data from thousands of nonprofits. Its Q4 2025 report covered the full year, and the headline was mixed: dollars rose 5.0%, but the number of donors fell 3.6%.</p>
      <h2>Fewer people, bigger checks</h2>
      <p>Overall donor retention edged up to 43.3%. That still means more than half of the people who gave in 2024 did not give in 2025. Growth came mostly from larger gifts while small donors kept falling away.</p>
      <Quote q={QUOTES[0]} />
      <h2>The second gift</h2>
      <p>The gap between new and repeat donors is the most useful number in fundraising. In FEP's Q4 2024 report, 19.4% of new donors gave again, compared with 69.2% of repeat donors. Get the second gift and a donor is far more likely to stay.</p>
      <h2>What moves the number</h2>
      <p>The research points to the same few habits: a fast, personal thank-you, proof that the gift mattered, and a renewal ask timed to the donor's own rhythm. Penelope Burk found that a thank-you call within 48 hours led to gifts 39% larger the next time. Adrian Sargeant's work suggests a 10% lift in retention can raise the lifetime value of a donor file by up to 200%.</p>
      <Quote q={QUOTES[1]} />
      <h2>What a small shop can do this week</h2>
      <p>Pull last year's donors who have not given this year. Call the top twenty. Thank every new gift within two days. Put a first-year plan on the calendar for every new donor. Steward does the sorting and the reminders. You do the part that only a person can.</p>
      <p className="srcnote">Sources: {["fep25", "fep24", "burk", "sarg"].map((k, i) => <React.Fragment key={k}>{i ? " · " : ""}<A href={SRC[k][1]}>{SRC[k][0]}</A></React.Fragment>)}</p>
    </div></section>
    <FinalCta />
  </>;
}

export function Glossary() {
  return <>
    <Hero eyebrow="Nonprofit glossary" crumbs={[["Resources", "/resources"], ["Glossary"]]} h="Fundraising terms, <b>in plain words.</b>" lede="The words you will hear in board meetings and on software demos, explained without jargon." noCta />
    <section style={{ paddingTop: 0 }}><dl className="wrap gloss" style={{ marginBlock: 0 }}>
      {GLOSS.map(g => <div key={g[0]}><dt>{g[0]}</dt><dd>{g[1]}</dd></div>)}
    </dl></section>
    <FinalCta />
  </>;
}

export function Faq() {
  return <>
    <Crumbs list={[["Resources", "/resources"], ["FAQ"]]} />
    <FaqS items={FAQ_PAGE} h="Questions? <b>We've got answers.</b>" as="h1" />
    <FinalCta />
  </>;
}

// HELP-1: the help centre. One article per screen, plus the tasks people come
// for, searchable over titles and bodies. Written from what each screen does
// today (shared/helpArticles.js); the app's "?" panel reads the same articles.
const TASK_FIRST = a => ((a.screens || []).length ? 1 : 0);
export function Help() {
  const [q, setQ] = useState("");
  const list = q.trim() ? searchArticles(HELP_ARTICLES, q, 20) : [...HELP_ARTICLES].sort((x, y) => TASK_FIRST(x) - TASK_FIRST(y) || x.title.localeCompare(y.title));
  return <>
    <Hero eyebrow="Help centre" crumbs={[["Customers"], ["Help centre"]]} h="How do I <b>do this in Steward?</b>" lede="An article for every screen and for the jobs people come for. If it is not here, a person answers." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the help centre" aria-label="Search the help centre"
        style={{ width: "100%", maxWidth: 560, padding: "12px 14px", fontSize: 16, borderRadius: 10, border: "1px solid #D4CFC6", marginBottom: 20, fontFamily: "inherit" }} />
      <div className="cards">
        {list.map(a => <A className="card" href={"/help/" + a.slug} key={a.slug}><h4>{a.title}</h4><p>{a.summary}</p><span className="go">Read</span></A>)}
        {!list.length && <p>Nothing in the help centre matches. Write to jonathan@stewardapp.dev and a person will answer.</p>}
      </div>
    </div></section>
    <FinalCta />
  </>;
}
export function HelpArticle({ slug }) {
  const a = HELP_ARTICLES.find(x => x.slug === slug);
  const [voted, setVoted] = useState(null);
  if (!a) return null;
  const vote = v => { setVoted(v); fetch(API + "/help/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: a.slug, helpful: v }) }).catch(() => {}); };
  return <>
    <Hero eyebrow="Help centre" crumbs={[["Customers"], ["Help centre", "/help"], [a.title]]} h={a.title} lede={a.summary} noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap prose" style={{ maxWidth: 760 }}>
      {(a.sections || []).map((s, i) => <div key={i}>{s.h && <h3>{s.h}</h3>}{(s.p || []).map((p, k) => <p key={k}>{p}</p>)}{s.steps && <ol>{s.steps.map((st, k) => <li key={k}>{st}</li>)}</ol>}</div>)}
      <p style={{ marginTop: 28 }}>{voted === null ? <>Did this help? <button type="button" className="btn" onClick={() => vote(true)}>Yes</button> <button type="button" className="btn" onClick={() => vote(false)}>No</button></> : "Thank you."}</p>
      <p><a href="/help">All help articles</a></p>
    </div></section>
  </>;
}

export function WhatsNew() {
  const [hidden, setHidden] = useState(null);
  React.useEffect(() => { fetch(`${API}/changelog/hidden`).then(r => r.json()).then(d => setHidden(new Set(d.hidden || []))).catch(() => setHidden(new Set())); }, []);
  const shown = CHANGELOG.filter(e => !hidden || !hidden.has(e.id));
  return <>
    <Hero eyebrow="What's new" crumbs={[["Customers"], ["What's new"]]} h="What we <b>shipped lately.</b>" lede="One entry for each thing we ship, newest first, written for the people who use Steward." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap chg">
      {shown.map(c => <div key={c.id} data-entry={c.id}><span className="chip">{PRODUCT_WORDS[c.product] || "New"}</span><div><b>{c.title}</b><p>{new Date(c.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. {c.body}</p></div></div>)}
    </div></section>
    <FinalCta />
  </>;
}

// ── FREE TOOLS ─────────────────────────────────────────────────────────────
// Ported as they work in the reference. Everything is computed in the
// browser; nothing on these pages sends anything anywhere.
export function Tools() {
  return <>
    <Hero eyebrow="Free tools" crumbs={[["Resources", "/resources"], ["Free tools"]]} h="Free tools, <b>no signup.</b>" lede="Run them on your own numbers. Nothing you type leaves your browser." noCta />
    <Cards list={[["/tools/lost-and-found", "Lost & Found donor audit", "See who you are about to lose from your own giving export.", "drift"], ["/tools/retention", "Keep Rate calculator", "Your retention rate, and what a few points are worth.", "reports"], ["/tools/lapsed-cost", "Lapse Ledger", "What last year's lapsed donors used to give.", "finance"], ["/tools/thermometer", "Goal Gauge", "A campaign goal bar for your website.", "events"]]} />
    <FinalCta />
  </>;
}

export function ToolLostAndFound() {
  return <>
    <Hero eyebrow="Lost & Found · free tool" crumbs={[["Free tools", "/tools"], ["Lost & Found"]]} h="See who you're <b>about to lose.</b>"
      lede="Drop in a giving export and see your lapsing donors and what they used to give. Free, no signup."
      noCta>
      <React.Suspense fallback={<div className="lf-loading" style={{ minHeight: 220 }} />}>
        <div data-lf-audit><LostAndFoundAudit compact /></div>
      </React.Suspense>
      <div className="ctas" style={{ marginTop: 34 }} data-lf-ctas>
        <Pill href="/demo">Book a demo</Pill>
        <Pill kind="soft" href="/signup">Start free</Pill>
      </div>
    </Hero>
    <Steps eb="How it works" h="A minute, <b>start to finish.</b>" list={[["Export your gifts", "Any spreadsheet with donor, date and amount."], ["Drop it in", "The audit reads it in your browser. Nothing is uploaded."], ["See who is slipping", "Lapsing donors ranked by what they used to give."]]} />
    <StatBand n={4} />
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
    <Hero eyebrow="Keep Rate calculator" crumbs={[["Free tools", "/tools"], ["Keep Rate calculator"]]} h="What is your <b>retention worth?</b>" lede="Enter last year's donors and how many gave again. See your rate beside the national figure, and what a five-point lift would mean." noCta />
    {/* Only the sourced pair opens the panel: any other rates in the link
        would print beside a source that never said them. */}
    {hi === RETENTION_GAP.withStrategy && lo === RETENTION_GAP.without && <GapPanel hi={hi} lo={lo} />}
    <section style={{ paddingTop: 0 }}><div className="wrap tool">
      <div className="form">
        <label>Donors last year<input type="number" min="1" value={v.a} onChange={on("a")} /></label>
        <label>Of those, gave again this year<input type="number" min="0" value={v.b} onChange={on("b")} /></label>
        <label>Average yearly gift ($)<input type="number" min="0" value={v.c} onChange={on("c")} /></label>
      </div>
      <div className="out" aria-live="polite">
        <div className="big">{m.rate}</div><p>your retention, against 43.3% nationally in 2025</p>
        <div className="big sm">{m.lift}</div><p>more each year from a five-point lift ({m.more} more donors giving again)</p>
      </div>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap"><p className="srcnote">National figure: 43.3% overall retention in 2025, <A href={SRC.fep25[1]}>{SRC.fep25[0]}</A>.</p></div></section>
    <FinalCta />
  </>;
}

export function ToolLapsed() {
  const [v, on] = useFields({ a: "580", b: "180", c: "15" });
  const m = lapsedMath(num(v.a), num(v.b), num(v.c));
  return <>
    <Hero eyebrow="Lapse Ledger" crumbs={[["Free tools", "/tools"], ["Lapse Ledger"]]} h="What did last year's lapsed donors <b>used to give?</b>" lede="A quick way to put a dollar figure on the people who quietly stopped." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tool">
      <div className="form">
        <label>Donors who did not give again<input type="number" min="0" value={v.a} onChange={on("a")} /></label>
        <label>Their average yearly gift ($)<input type="number" min="0" value={v.b} onChange={on("b")} /></label>
        <label>Share who might give again after a call (%)<input type="number" min="0" max="100" value={v.c} onChange={on("c")} /></label>
      </div>
      <div className="out" aria-live="polite">
        <div className="big">{m.lost}</div><p>a year, given by donors who stopped</p>
        <div className="big sm">{m.back}</div><p>more a year if {num(v.c)}% give again after a call</p>
      </div>
    </div></section>
    <FinalCta />
  </>;
}

export function ToolThermometer() {
  const [v, on] = useFields({ n: "Spring appeal", g: "50000", r: "31250" });
  const m = thermometerMath(num(v.g), num(v.r));
  return <>
    <Hero eyebrow="Goal Gauge" crumbs={[["Free tools", "/tools"], ["Goal Gauge"]]} h="A goal bar <b>people want to fill.</b>" lede="Set your goal and amount raised and see the bar. The embeddable version comes with the live site." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tool">
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
    </div></section>
    <FinalCta />
  </>;
}

// ── LEGAL (drafts) ─────────────────────────────────────────────────────────
// They ship with the "Draft for attorney review" badge, exactly as the
// reference shows. The live, in-effect documents stay at /privacy and /terms.
function Legal({ t, children }) {
  return <>
    <Crumbs list={[["Company"], [t]]} />
    <section className="hero phero" style={{ paddingBottom: 30 }}><div className="wrap">
      <div className="eyebrow">Legal</div><h1 className="mix h-l">{t}</h1>
      <p className="draft">Draft for attorney review. Not yet in effect.</p>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap prose narrow">{children}</div></section>
  </>;
}

export function LegalPrivacy() {
  return <Legal t="Privacy policy">
    <h2>Who we are</h2><p>{LEGAL_ENTITY_NAME} ("Steward") provides donor management software to nonprofit organizations. Contact: jonathan@stewardapp.dev.</p>
    <h2>Two kinds of data</h2><p>Organizations that use Steward put information about their donors, volunteers and contacts into the service. That information belongs to the organization, and we process it only to provide Steward to them. Separately, we collect a small amount of information about the people who sign in to Steward, such as name, email and usage, to run the service.</p>
    <h2>Connected accounts</h2><p>When a user connects Google or Microsoft, Steward reads only email and calendar items involving people already in that organization's Steward account, and stores only what is needed to show them on the record. Steward does not use this data for advertising, does not sell it and does not use it to train general artificial intelligence models. Users can disconnect at any time.</p>
    <h2>Sharing</h2><p>We never sell personal information. We share it only with service providers that run Steward on our behalf, such as hosting and email delivery, under contract.</p>
    <h2>Your choices</h2><p>Organizations can export or delete their data at any time. Individuals can contact the organization that holds their information, or us.</p>
    <h2>Changes</h2><p>We will post changes here and tell customers by email.</p>
  </Legal>;
}

export function LegalTerms() {
  return <Legal t="Terms of service">
    <h2>The service</h2><p>Steward provides donor management software on a subscription basis, month to month or yearly.</p>
    <h2>Your data</h2><p>You own the data you put into Steward. You can export it at any time. After cancellation we delete it on request.</p>
    <h2>Payments</h2><p>Plans are billed in advance. Gifts made through Steward forms go to your own payment processor account. Steward charges no platform fee on gifts.</p>
    <h2>Acceptable use</h2><p>Use Steward only for lawful fundraising and organizational purposes, and only with data you have the right to use.</p>
    <h2>Cancellation</h2><p>Cancel any time. Monthly plans end at the close of the current month.</p>
  </Legal>;
}

export function LegalAccessibility() {
  return <Legal t="Accessibility">
    <p>We want everyone who works at a nonprofit, and everyone who gives to one, to be able to use Steward. We design to the Web Content Accessibility Guidelines 2.1 at level AA, test with keyboards and screen readers, and fix what we find.</p>
    <p>If anything in Steward or on this site is hard to use, email jonathan@stewardapp.dev and we will respond within two business days.</p>
  </Legal>;
}

// PROOF-2 · every source the site quotes, from shared/sources.js: the claim
// in the source's words, the link, and the day a person last checked it.
export function Research() {
  return <>
    <Hero eyebrow="Research" crumbs={[["Resources", "/resources"], ["Research"]]} h="Every number, <b>and where it came from.</b>"
      lede="Each statistic on this site comes from one of the sources below, worded as the source words it. Survey findings are what respondents reported. Follow any link and check us." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap" style={{ maxWidth: 940 }}>
      <div className="srcs">
        {SOURCE_KEYS.map(k => {
          const x = SOURCES[k];
          return <article key={k} id={k} data-source={k}>
            <h3>{x.source}</h3>
            <p className="meta">{x.report} · {x.year} · {x.sample}</p>
            <ul>{x.claims.map(c => <li key={c.figure + c.claim}><b>{c.figure}</b> · {c.claim}</li>)}</ul>
            <A className="lk" href={x.url}>{x.url}</A>
            <p className="meta">Checked {checkedOn(x.checked)}</p>
          </article>;
        })}
      </div>
    </div></section>
    <FinalCta />
  </>;
}


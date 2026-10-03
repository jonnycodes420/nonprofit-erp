// LANDING-2 · the Resources menu: guides, templates, articles, the glossary,
// the FAQ, help, what's new, the three calculators and the legal drafts.
import React, { useState } from "react";
import { Hero, Crumbs, Cards, FaqS, FinalCta, StatBand, Photo, Pill, A, Cover, rich } from "../lib";
import { GUIDES, GUIDE_SLUGS } from "../data/guides";
import { TEMPL } from "../data/templates";
import { API } from "../../api";
import { PRODUCT_WORDS } from "../../../../shared/changelog.js";
import { HELP_ARTICLES } from "../../../../shared/helpArticles.js";
import { searchArticles } from "../../../../shared/helpSearch.js";
// TRUST-2: What's new is the files in docs/changelog/, one per build, never
// generated from commit messages. A super-admin can hide an entry.
import { CHANGELOG } from "../../lib/changelog";
import { ARTICLE, ARTICLE_SLUGS, inline } from "../articles/index.js";
import { GLOSSARY, TERM } from "../data/glossary";
import { ROUTES } from "../routes";
import { FAQ_PAGE } from "../data/faqs";
import { SRC, SRC_ALL, QUOTES } from "../data/research";
import { SOURCES, SOURCE_KEYS, checkedOn } from "../../../../shared/sources.js";
import { LEGAL_ENTITY_NAME } from "../../../../shared/legalEntity.js";


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
// LANDING-3 · article cards wear a generated cover, never a photograph: an
// ink, emerald or tint block with a serif title and a leaf. They cost nothing
// to load and stay legible at any size.
export function ArtCards({ keys }) {
  return (
    <div className="res">
      {keys.map((k, i) => {
        const a = ARTICLE[k];
        return (
          <A className="rc" href={"/articles/" + k} key={k}>
            <Cover t={a.cover[0]} b={a.cover[1]} i={i} />
            <span className="k">{a.kicker} · {a.minutes} min</span>
            <h4>{a.title.replace(/\.$/, "")}</h4><p>{a.description}</p>
            <span className="go">Read →</span>
          </A>
        );
      })}
    </div>
  );
}

export function Articles() {
  return <>
    <Hero eyebrow="Articles" crumbs={[["Resources", "/resources"], ["Articles"]]} h="Ideas worth <b>a coffee break.</b>" lede="Short reads on retention, stewardship and running a calm development office." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><ArtCards keys={ARTICLE_SLUGS} />
      <p className="srcnote" style={{ marginTop: 28 }}>New articles by feed: <a href="/rss.xml">RSS</a></p>
    </div></section>
    <FinalCta />
  </>;
}

// CONTENT-1 · inline markdown as elements: bold, italic and links, nothing else.
function Toks({ list }) {
  return list.map((t, i) => t[0] === "b" ? <b key={i}><Toks list={t[1]} /></b> : t[0] === "em" ? <em key={i}><Toks list={t[1]} /></em> : t[0] === "a" ? <A key={i} href={t[2]}>{t[1]}</A> : <React.Fragment key={i}>{t[1]}</React.Fragment>);
}
export function Md({ s }) {
  return <Toks list={inline(s)} />;
}

// A research quote inside an article, with its source. LANDING-3 deleted this
// while the two calls below stayed, and the article threw on render (PROOF-2).
const srcShortOf = k => SRC[k][0].split(",")[0];
const Quote = ({ q }) => <blockquote data-quote="research">{q[0]}<cite>{q[1]}, {q[2]} · <A href={SRC[q[3]][1]}>{srcShortOf(q[3])}</A></cite></blockquote>;

function Block({ b }) {
  if (b.t === "h2") return <h2><Md s={b.text} /></h2>;
  if (b.t === "h3") return <h3><Md s={b.text} /></h3>;
  if (b.t === "ul") return <ul>{b.items.map((x, i) => <li key={i}><Md s={x} /></li>)}</ul>;
  if (b.t === "ol") return <ol>{b.items.map((x, i) => <li key={i}><Md s={x} /></li>)}</ol>;
  if (b.t === "quote") return <Quote q={QUOTES[b.i]} />;
  if (b.t === "example") return <div className="worked" role="note"><b>Worked example</b>{b.lines.filter(l => l.trim()).map((l, i) => <p key={i}>{l}</p>)}</div>;
  return <p><Md s={b.text} /></p>;
}

const longDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// The closing pair every article and glossary page ends on: find who is
// slipping in your own file, then bring that file to a demo.
export function LostAndFoundCallout({ b = "See who is slipping in your own file." }) {
  return <div className="callout"><b>{b}</b><p>The free Lost & Found audit reads a giving export in your browser and shows your lapsing donors and what they used to give. Nothing is uploaded. Then bring the same file to a 20-minute demo.</p><div className="ctas" style={{ marginTop: 6 }}><Pill href="/tools/lost-and-found">Run Lost & Found</Pill><Pill kind="soft" href="/demo">Book a demo</Pill></div></div>;
}

// The one template for every article in articles/*.md.
export function Article({ slug }) {
  const a = ARTICLE[slug];
  const i = ARTICLE_SLUGS.indexOf(slug);
  const terms = a.terms.map(t => TERM[t]).filter(Boolean);
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Articles", "/articles"], [a.title.replace(/\.$/, "")]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap hero-g">
      <div>
        <div className="eyebrow">{a.kicker} · {a.minutes} minute read</div>
        <h1 className="mix h-l">{rich(a.headline)}</h1>
        <p className="lede">{a.description}</p>
        <p className="byline">By {a.author} · <time dateTime={a.date}>{longDate(a.date)}</time></p>
      </div>
      <Cover t={a.cover[0]} b={a.cover[1]} i={i} />
    </div></section>
    <section style={{ paddingTop: 0 }}><article className="wrap prose narrow">
      <p><Md s={a.lede} /></p>
      {a.blocks.map((b, n) => <Block b={b} key={n} />)}
      {a.sources.length > 0 && <p className="srcnote">{a.sources.length > 1 ? "Sources" : "Source"}: {a.sources.map((k, n) => <React.Fragment key={k}>{n ? " · " : ""}<A href={SOURCES[k].url}>{SOURCES[k].label}</A></React.Fragment>)}</p>}
      {terms.length > 0 && <p className="termrow"><b>Terms in this article</b>{terms.map(t => <A key={t.slug} href={"/glossary/" + t.slug}>{t.term}</A>)}</p>}
      <LostAndFoundCallout />
    </article></section>
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">Keep reading</div>
      <ArtCards keys={ARTICLE_SLUGS.filter(x => x !== slug).slice(0, 3)} />
    </div></section>
    <FinalCta />
  </>;
}

// CONTENT-1 · the glossary index. Every term has its own page.
export function Glossary() {
  const sorted = [...GLOSSARY].sort((x, y) => x.term.localeCompare(y.term));
  return <>
    <Hero eyebrow="Nonprofit glossary" crumbs={[["Resources", "/resources"], ["Glossary"]]} h="Fundraising terms, <b>in plain words.</b>" lede="The words you will hear in board meetings and on software demos, explained without jargon. Each term has its own page with why it matters, how to work it out and how Steward shows it." noCta />
    <section style={{ paddingTop: 0 }}><dl className="wrap gloss" style={{ marginBlock: 0 }}>
      {sorted.map(g => <div key={g.slug} id={g.slug}><dt><A href={"/glossary/" + g.slug}>{g.term}</A></dt><dd>{g.def}</dd></div>)}
    </dl></section>
    <FinalCta />
  </>;
}

const titleOf = p => (ROUTES.find(r => r.path === p) || {}).title || p;
const seeCard = p => [p, titleOf(p).replace(/^Steward · /, ""), p.startsWith("/tools/") ? "Free tool. Runs in your browser." : "Article.", p.startsWith("/tools/") ? "reports" : "forms"];

// CONTENT-1 · one page per term: the definition first, then why it matters,
// the arithmetic when it is a number, how Steward shows it, and where to go next.
export function GlossaryTerm({ slug }) {
  const g = TERM[slug];
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Glossary", "/glossary"], [g.term]]} />
    <section className="hero phero" style={{ paddingBottom: 30 }}><div className="wrap">
      <div className="eyebrow">Nonprofit glossary{g.aka ? " · " + g.aka : ""}</div>
      <h1 className="mix h-l">{g.term}</h1>
      <p className="lede definition" data-definition>{g.def}</p>
    </div></section>
    <section style={{ paddingTop: 0 }}><article className="wrap prose narrow">
      <h2>Why it matters</h2>
      {g.why.map((p, i) => <p key={i}>{p}</p>)}
      {g.calc && <>
        <h2>How to calculate it</h2>
        <p className="formula">{g.calc.formula}</p>
        <div className="worked" role="note"><b>Worked example</b>{g.calc.example.map((l, i) => <p key={i}>{l}</p>)}</div>
      </>}
      {g.steward && g.steward.length > 0 && <>
        <h2>How Steward shows it</h2>
        {g.steward.map((p, i) => <p key={i}>{p}</p>)}
      </>}
      {g.src && <p className="srcnote">Source: {g.src.map((k, n) => <React.Fragment key={k}>{n ? " · " : ""}<A href={SOURCES[k].url}>{SOURCES[k].label}</A></React.Fragment>)}</p>}
      <h2>Related terms</h2>
      <ul className="termlist">{g.related.map(r => <li key={r}><A href={"/glossary/" + r}><b>{TERM[r].term}</b></A> {TERM[r].def}</li>)}</ul>
      <LostAndFoundCallout />
    </article></section>
    {g.see && g.see.length > 0 && <Cards eb="Read and try" h="Put it <b>to work.</b>" list={g.see.map(seeCard)} />}
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


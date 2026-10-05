// LANDING-2 · the building blocks every marketing page is made of. Each one
// is the reference's helper of the same name (docs/landing/steward-site.html:
// hero, block, ui, steps, incl, faqS, cards, related, finalCta, statBand,
// quoteBand, teamReel), producing the same markup and classes, so site.css
// styles it exactly as the reference does.
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ICON } from "./data/icons";
import { PHOTOS, photoSrc, rowFor } from "./data/photos";
import { FEAT } from "./data/features";
import { SRC, STATS, QUOTES, srcShort } from "./data/research";
import { LEADERSHIP_SHOWN } from "./data/team";
import { CREW, CREW_NEVER } from "./data/crew";
import PRICING from "../../../pricing.json";

// ── Rich strings ───────────────────────────────────────────────────────────
// Copy in the data modules keeps the reference's inline <b>, <em> and <br>.
// This turns exactly those three tags into elements; anything else stays text.
export function rich(s) {
  if (s == null || typeof s !== "string") return s;
  const root = [];
  const stack = [{ tag: null, kids: root }];
  const re = /<(\/?)(b|em|br)\s*\/?>/g;
  let last = 0, m, k = 0;
  const top = () => stack[stack.length - 1].kids;
  while ((m = re.exec(s))) {
    if (m.index > last) top().push(s.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] === "br") top().push(<br key={k++} />);
    else if (!m[1]) stack.push({ tag: m[2], kids: [] });
    else if (stack.length > 1) {
      const done = stack.pop();
      const El = done.tag;
      top().push(<El key={k++}>{done.kids}</El>);
    }
  }
  if (last < s.length) top().push(s.slice(last));
  return root.length === 1 ? root[0] : root;
}

// ── Links ──────────────────────────────────────────────────────────────────
// An internal path is a router <Link>; a source link opens in a new tab the
// way the reference's do; mailto stays a plain anchor.
export function A({ href, children, ...rest }) {
  if (href && href.startsWith("/")) return <Link to={href} {...rest}>{children}</Link>;
  const ext = /^https?:/.test(href || "");
  return <a href={href} {...(ext ? { target: "_blank", rel: "noopener" } : {})} {...rest}>{children}</a>;
}

export function Pill({ href, kind = "ink", style, children }) {
  return <A className={"pill pill-" + kind} href={href} style={style}><i></i>{children}</A>;
}

export const Arrow = () => (
  <i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></i>
);

export const Tick = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="#0D5C3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const Plus = () => (
  <span className="x" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" /></svg></span>
);

// The reference's ic(): a 24-unit stroke icon from the ICON set.
export function Icon({ k, size = 22, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON[k] || ICON.check }} />
  );
}

// ── Photographs ────────────────────────────────────────────────────────────
// The reference's ph(): a photo slot. The stand-in caption is gone; the slot
// holds the real photograph, cropped to fill it.
export function Photo({ k, cls = "", eager, style }) {
  const p = PHOTOS[k];
  if (!p) throw new Error("marketing: no photo named " + k);
  return (
    <div className={"photo has-img " + cls} style={style}>
      <img src={photoSrc(k)} alt={p.alt} width={p.w} height={p.h}
        loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchpriority: "high" } : {})} />
    </div>
  );
}

// A real person's portrait. Used only for TEAM.
export function Portrait({ src, name, cls = "tall" }) {
  return (
    <div className={"photo has-img portrait " + cls}>
      <img src={src} alt={"Portrait of " + name} loading="lazy" decoding="async" />
    </div>
  );
}

// ── Page furniture ─────────────────────────────────────────────────────────
export function Crumbs({ list }) {
  return (
    <nav className="crumbs wrap" aria-label="Breadcrumb">
      <A href="/">Home</A>
      {list.map((c, i) => (
        <React.Fragment key={i}> <span>/</span> {c[1] ? <A href={c[1]}>{c[0]}</A> : <b>{c[0]}</b>}</React.Fragment>
      ))}
    </nav>
  );
}

// LANDING-3 · EVERY hero shows Book a call and Start free, and the reference's
// updated hero() is what settled it: it stopped reading cta2 at all and
// hardcodes the pair whenever noCta is not set. A page no longer gets to
// choose its second button, so the twelve noCta pages (articles, guides, the
// calculators, the legal drafts) still show none, and every other hero shows
// the same two. No hero offers a tour or says "See pricing".
// LANDING-4 · `pillar` (from data/messaging.js) opens the page with the pillar
// it serves, in MESSAGING.md's words: its heading is the first line, above
// the page's own h1. The crumbs still name the page.
export function Hero({ eyebrow, crumbs, h, lede, photo, noCta, proof, float, pillar, children }) {
  return (
    <>
      <Crumbs list={crumbs || [[eyebrow]]} />
      <section className="hero phero">
        <div className={"wrap hero-g" + (photo ? "" : " solo")}>
          <div>
            <div className="eyebrow" data-pillar-line={pillar ? pillar.n : undefined}>{pillar ? pillar.t : eyebrow}</div>
            <h1 className="mix h-xl">{rich(h)}</h1>
            <p className="lede">{rich(lede)}</p>
            {!noCta && (
              <div className="ctas">
                <Pill href="/demo">Book a call</Pill>
                <Pill kind="soft" href="/signup">Start free</Pill>
              </div>
            )}
            {proof && <div className="proof">{proof.map(p => <span key={p}>{p}</span>)}</div>}
            {children}
          </div>
          {photo && <div className="collage one"><Photo k={photo} cls="p1" eager />{float}</div>}
        </div>
      </section>
    </>
  );
}

// The reference's ui(): a product screen drawn in HTML with example data.
export function Ui({ t, k, rows, tots }) {
  return (
    <div className="ui" role="img" aria-label={t + " screen"}>
      <div className="uh"><i><Icon k={k} size={18} color="#fff" /></i>{t}</div>
      {(rows || []).map((r, i) => (
        <div className="row" key={"r" + i}>
          <div className="av">{r[0]}</div>
          <div><div className="nm">{rich(r[1])}</div><div className="mt">{rich(r[2])}</div></div>
          {r[4] ? <span className={"chip" + (r[4] === "q" ? " q" : "")}>{r[3]}</span> : <div className="act">{r[3]}</div>}
        </div>
      ))}
      {(tots || []).map((r, i) => (
        <div className="tot" key={"t" + i}>
          <span>{r[0]}</span><em>{r[1]}</em><span className={r[3] ? "ok" : undefined}>{r[2]}</span>
        </div>
      ))}
    </div>
  );
}
export const uiOf = a => <Ui t={a[0]} k={a[1]} rows={a[2]} tots={a[3]} />;

export function Block({ flip, tint = "cream", h, p, sh, sp, ui, photo }) {
  return (
    <div className={"alt" + (flip ? " flip" : "")}>
      <div>
        <div className="tint" style={{ background: "var(--" + tint + ")" }}><h3>{rich(h)}</h3><p>{rich(p)}</p></div>
        {sh && <div className="sub"><h4>{rich(sh)}</h4><p>{rich(sp)}</p></div>}
      </div>
      <div className="stage">
        <div className="bg" style={{ background: "var(--" + tint + ")" }}></div>
        {ui || <Photo k={photo} cls="wide" />}
      </div>
    </div>
  );
}

// LANDING-4 · a real product screen: a screenshot taken from the Harborlight
// demo organisation (client/public/marketing/product), never a mock. `cap`
// says in one line what the screen shows.
export function Shot({ k, alt, cap, cls = "" }) {
  return (
    <div className={"shot " + cls} data-shot={k}>
      <img src={"/marketing/product/" + k + ".webp"} alt={alt} loading="lazy" decoding="async" />
      {cap && <p className="shot-cap">{cap}</p>}
    </div>
  );
}

// LANDING-5 · a person and the product, side by side: a photograph of
// someone at work, with a tight crop of the Harborlight screen overlapping
// its corner. Neither is ever drawn larger than its file (photos are 1000px
// wide and sit under 400px; the crops are 700 to 1000px and sit under 480px),
// so both stay sharp on a 2x screen. The photograph carries the alt text and
// describes the person; the crop is decorative, because the words beside it
// say what it shows.
export function PersonPair({ k, shot, pos, eager }) {
  return (
    <div className="pair" style={pos ? { "--pos": pos } : undefined}>
      <Photo k={k} cls="pair-photo" eager={eager} />
      {shot && <img className="pair-shot" src={"/marketing/product/" + shot + ".webp"} alt="" loading="lazy" decoding="async" />}
    </div>
  );
}

// LANDING-4's pillar band, with LANDING-5's fewer words: the number, the
// heading and one line on one side, the picture on a tinted panel on the other.
export function PillarBand({ p, tint = "cream", flip, link, children }) {
  return (
    <section className={"pillar" + (flip ? " flip" : "")} data-pillar={p.n} style={{ paddingTop: 0 }}><div className="wrap pillar-g">
      <div className="pillar-txt">
        <span className="pillar-n">{"0" + p.n}</span>
        <h2 className="mix h-l">{rich(p.h)}</h2>
        <p>{p.line}</p>
        {link && <p className="pillar-go"><A href={link[0]}>{link[1]} →</A></p>}
      </div>
      <div className="pillar-art" style={{ background: "var(--" + tint + ")" }}>{children}</div>
    </div></section>
  );
}

// LANDING-5 · the one price block, on Home and /pricing. The tier table is
// gone from the marketing site; the starting price is the lowest monthly
// price in pricing.json, so the page and the signup route cannot disagree.
export function PriceBlock({ h1 }) {
  const from = Math.min(...PRICING.tiers.map(t => t.monthlyUsd));
  const H = h1 ? "h1" : "h2";
  return (
    <section className="price-block" data-testid="price-block"><div className="wrap">
      <div className="eyebrow">Pricing</div>
      <H className="mix h-l">Starting at ${from} a month. <b>{PRICING.marketing.included}</b></H>
      <div className="ctas"><Pill href="/demo">Book a call</Pill></div>
    </div></section>
  );
}

export function Steps({ eb, h, list }) {
  return (
    <section className="steps-s"><div className="wrap">
      <div className="eyebrow">{eb}</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>{rich(h)}</h2>
      <div className="steps">
        {list.map((s, i) => (
          <div className="step" key={i}><span className="sn">{(i + 1 < 10 ? "0" : "") + (i + 1)}</span><h4>{s[0]}</h4><p>{s[1]}</p></div>
        ))}
      </div>
    </div></section>
  );
}

export function Incl({ h, list, eb }) {
  return (
    <section className="pricing"><div className="wrap">
      <div className="eyebrow">{eb || "What's included"}</div>
      <h2 className="mix h-m" style={{ marginTop: 22 }}>{rich(h)}</h2>
      <div className="incl">{list.map(x => <span key={x}><Tick />{x}</span>)}</div>
    </div></section>
  );
}

export function FaqList({ items }) {
  return items.map((q, i) => (
    <details key={i}><summary><span className="n">[ {i + 1} ]</span>{q[0]}<Plus /></summary><p>{q[1]}</p></details>
  ));
}

export function FaqS({ items, h, as: H = "h2" }) {
  return (
    <section><div className="wrap faq">
      <div><div className="eyebrow">FAQ</div><H className="mix h-l" style={{ marginTop: 22 }}>{rich(h || "Good <b>questions.</b>")}</H></div>
      <div><FaqList items={items} /></div>
    </div></section>
  );
}

// The reference's cards(): [href, title, text, icon?] link cards.
export function Cards({ list, eb, h }) {
  return (
    <section style={{ paddingTop: h ? 112 : 0 }}><div className="wrap">
      {h && <><div className="eyebrow">{eb}</div><h2 className="mix h-m" style={{ marginTop: 22 }}>{rich(h)}</h2></>}
      <div className="cards">
        {list.map(c => (
          <A className="card" href={c[0]} key={c[0] + c[1]}>
            {c[3] && <span className="ci"><Icon k={c[3]} size={26} /></span>}
            <h4>{c[1]}</h4><p>{c[2]}</p><span className="go">Learn more →</span>
          </A>
        ))}
      </div>
    </div></section>
  );
}

export const featureCard = s => ["/features/" + s, FEAT[s].name, FEAT[s].short, FEAT[s].icon];

export function Related({ slugs }) {
  return <Cards list={slugs.map(featureCard)} eb="Related" h="Works well <b>with these.</b>" />;
}

// LANDING-3 · the closing call to action, and the photo row that comes just
// before it. Putting the row here is what makes section 6 automatic: every
// page already ends with a FinalCta, so each one gains the three photographs
// its section calls for, and the pages rowFor() excludes gain nothing.
export function FinalCta() {
  const { pathname } = useLocation();
  return (
    <>
      <PhotoRow row={rowFor(pathname)} />
      <section style={{ paddingTop: 0 }}><div className="final"><div className="wrap" style={{ paddingBlock: 110 }}>
        <div className="eyebrow">Ready to get started?</div>
        <h2 className="mix h-l" style={{ marginTop: 22 }}>Every donor is a person. <b style={{ color: "var(--emerald-lt)" }}>Keep them.</b></h2>
        <p>Book a 20-minute call with your own file, or start free for 30 days.</p>
        <div className="ctas" style={{ marginTop: 36 }}><Pill kind="white" href="/demo">Book a call</Pill><Pill kind="soft" href="/signup">Start free</Pill></div>
      </div></div></section>
    </>
  );
}

// The homepage's own pair, which the reference splits in two: the demo on the
// left, starting now on the right. No tour on either side.
export function ReadyPair() {
  return (
    <section className="ready"><div className="wrap ready-g">
      <div><div className="eyebrow">Ready to get started?</div><h2 className="mix h-m" style={{ marginTop: 16 }}>Twenty minutes, <b>your own file.</b></h2><Pill href="/demo" style={{ marginTop: 26 }}>Book a call</Pill></div>
      <div><div className="eyebrow">Rather start now?</div><h2 className="mix h-m" style={{ marginTop: 16 }}>Thirty days <b>free.</b></h2><Pill kind="soft" href="/signup" style={{ marginTop: 26 }}>Start free</Pill></div>
    </div></section>
  );
}

// The reference's statBand(n, dark): the first n research numbers, each with
// its own source link, then every source in full.
export function StatBand({ n, dark }) {
  const list = STATS.slice(0, n || STATS.length);
  const used = [...new Set(list.map(s => s[2]))];
  const body = (
    <div className="wrap" style={dark ? { paddingBlock: 96 } : undefined}>
      <div className="eyebrow" style={dark ? { color: "var(--white)" } : undefined}>What the research says</div>
      <h2 className="mix h-l" style={{ marginTop: 22, ...(dark ? { color: "var(--white)" } : {}) }}>Donors don't leave in anger. <b>They drift.</b></h2>
      <div className="stats">
        {list.map(s => (
          <div className="stat" key={s[0]} data-stat={s[0]}><b>{s[0]}</b><p>{s[1]}</p><A href={SRC[s[2]][1]}>{srcShort(s[2])}</A></div>
        ))}
      </div>
      <p className="srcnote">Sources: {used.map((k, i) => <React.Fragment key={k}>{i ? " · " : ""}<A href={SRC[k][1]}>{SRC[k][0]}</A></React.Fragment>)}</p>
    </div>
  );
  return <section style={dark ? { paddingTop: 0 } : undefined}>{dark ? <div className="ink">{body}</div> : <div className="wrap">{body}</div>}</section>;
}

export function QuoteBand() {
  return (
    <section style={{ paddingTop: 0 }}><div className="wrap qband">
      {QUOTES.map(q => (
        <figure key={q[1]} data-quote="research">
          <blockquote data-quote="research">{q[0]}</blockquote>
          <figcaption><b>{q[1]}</b><span>{q[2]}</span><A href={SRC[q[3]][1]}>{SRC[q[3]][0]}</A></figcaption>
        </figure>
      ))}
    </div></section>
  );
}

// ── People ────────────────────────────────────────────────────────────────
// LANDING-3 · the reel is gone. There is no people carousel anywhere on the
// site, and tests/landing3-marketing.test.js proves no route renders one.
//
// The reference's person(): a portrait in a tinted frame, tilted, with an ink
// pill naming the role. The frame straightens and lifts on hover (site.css).
const TINTS = ["brass-tint", "emerald-tint", "cream-2", "brass-tint"];

export function Person({ t, i }) {
  const role = t[1].split(" \u00b7 ");
  return (
    <div className="pp" style={{ "--tint": "var(--" + TINTS[i % 4] + ")", "--tilt": i % 2 ? "1.6deg" : "-1.6deg" }}>
      <div className="pp-frame">
        <Portrait src={t[2]} name={t[0]} />
        <span className="pp-tag">{role[0]}</span>
      </div>
      <b>{t[0]}</b><span>{role[1] || role[0]}</span>
    </div>
  );
}

export function People() {
  return <div className="wrap lead-g">{LEADERSHIP_SHOWN.map((t, i) => <Person key={t[0]} t={t} i={i} />)}</div>;
}

// The homepage band that stands where the reel did: one line, one button.
export function LeadBand() {
  return (
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="lead-band">
      <div>
        <div className="eyebrow">Leadership</div>
        <h2 className="mix h-m" style={{ marginTop: 16 }}>A founder who answers, <b>advisors who've raised.</b></h2>
        <p>Steward is led by its founder with advisors from nonprofit development, arts and philanthropy. Funded by angel investment.</p>
      </div>
      <Pill href="/leadership">Meet our leadership</Pill>
    </div></div></section>
  );
}

// ── Article covers ────────────────────────────────────────────────────────
// The reference's cover(): a drawn block, never a photograph, so an article
// card is legible at any size and costs nothing to load.
const COVERS = [["ink", "brass"], ["emerald", "white"], ["brass-tint", "emerald"], ["ink", "emerald-lt"], ["emerald-tint", "emerald"], ["cream-2", "brass-text"]];

export function Cover({ t, b, i }) {
  const c = COVERS[i % COVERS.length];
  return (
    <div className="cover" style={{ "--bg": "var(--" + c[0] + ")", "--em": "var(--" + c[1] + ")" }}
      data-cover={c[0]}>
      <div className="t">{t}<br /><b>{b}</b></div><span className="leaf"></span>
    </div>
  );
}

// ── Photo rows ────────────────────────────────────────────────────────────
// The reference's photoRow(): three real photographs before the closing call
// to action. rowFor() in data/photos.js decides which three, and returns null
// for the pages that take none.
export function PhotoRow({ row }) {
  if (!row) return null;
  return (
    <section className="photo-row-s" style={{ paddingTop: 0 }}>
      <div className="wrap photo-row">{row.map((k, i) => <Photo k={k} key={k} cls={i === 1 ? "tall" : ""} />)}</div>
    </section>
  );
}

// ── The Agent crew ────────────────────────────────────────────────────────
// Six tabs, one panel. Tabs are real buttons in a real tablist, so a keyboard
// reaches every one and a tap works at 390 (site.css puts the tabs in two
// columns under 1000px and one under 600px).
export function AgentCrew() {
  const [sel, setSel] = useState(0);
  return (
    <section className="pricing" id="crew"><div className="wrap">
      <div className="eyebrow">Meet the crew</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>Six assistants. <b>One rule: you decide.</b></h2>
      <p className="lede" style={{ marginTop: 20 }}>Each one reads your whole file, shows you exactly what it plans to do and waits. Pick one to see it work. Examples use demo data.</p>
      <div className="crew">
        <div className="crew-tabs" role="tablist" aria-label="Steward Agent assistants">
          {CREW.map((a, i) => (
            <button key={a.n} type="button" role="tab" id={"crew-tab-" + i} aria-selected={sel === i ? "true" : "false"}
              aria-controls={"crew-pane-" + i} className={"crew-tab c-" + a.c} onClick={() => setSel(i)}>
              <span className="crew-ic"><CrewIcon d={a.i} size={22} /></span>
              <span><b>{a.n}</b><em>{a.tag}</em></span>
            </button>
          ))}
        </div>
        <div className="crew-panes">
          {CREW.map((a, i) => (
            <div className={"crew-pane c-" + a.c} key={a.n} id={"crew-pane-" + i} role="tabpanel"
              aria-labelledby={"crew-tab-" + i} hidden={sel !== i}>
              <div className="crew-head">
                <span className="crew-ic big"><CrewIcon d={a.i} size={30} /></span>
                <div><h3>The {a.n}</h3><p>{a.tag}</p></div>
              </div>
              <div className="crew-flow">
                <div className="cf say"><span>You say</span><p>&ldquo;{a.say}&rdquo;</p></div>
                <div className="cf plan"><span>It shows you the plan</span><ol>{a.does.map(d => <li key={d}>{d}</li>)}</ol></div>
                <div className="cf ok"><span>You approve</span><p>{a.out}</p>
                  <div className="crew-btns"><b>Approve</b><i>Change</i><i>Undo any time</i></div>
                </div>
              </div>
              <div className="crew-power">{a.power.map(x => <span key={x}><Tick />{x}</span>)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="crew-never"><b>None of them ever</b>{CREW_NEVER.map(x => <span key={x}>{x}</span>)}</div>
    </div></section>
  );
}

const CrewIcon = ({ d, size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);

export function Prose({ children }) {
  return <section style={{ paddingTop: 40 }}><div className="wrap prose">{children}</div></section>;
}

// ── Head tags ──────────────────────────────────────────────────────────────
// Title, description, canonical and the Open Graph / Twitter tags, per route.
export const SITE_ORIGIN = "https://www.stewardapp.dev";
function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", value);
}
export function useHead({ title, description, path }) {
  useEffect(() => {
    const url = SITE_ORIGIN + (path === "/" ? "/" : path);
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", url);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:site_name", "Steward");
    setMeta("property", "og:image", SITE_ORIGIN + "/og-image.png");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.setAttribute("rel", "canonical"); document.head.appendChild(link); }
    link.setAttribute("href", url);
  }, [title, description, path]);
  // Leaving the marketing site takes the canonical with it, so an app page
  // never claims a marketing URL.
  useEffect(() => () => { document.head.querySelector('link[rel="canonical"]')?.remove(); }, []);
}

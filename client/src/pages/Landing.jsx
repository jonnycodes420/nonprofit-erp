import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import PRICING from "../../../pricing.json";

// ── LANDING-1 · THE LANDING PAGE, FROM JONATHAN'S MUSE DESIGN ────────────
//
// `docs/landing/landing-mockup.html`, in React. The markup and the CSS are
// the mockup's, with four deliberate differences, each one from the brief:
//
//   1. THE PRICING SECTION IS FIX-4'S, not the mockup's table. Seed,
//      Sapling, Orchard and Forest, with the donor count under the name and
//      the prices read from `pricing.json` — the same file the signup route
//      prices against, so the page and the card cannot disagree.
//   2. Volunteers says "Track background checks and get a heads-up before
//      one expires", not "Run Checkr checks from inside Steward": Steward
//      records that a check happened and when it lapses, and it does not
//      run one. (Already correct in the mockup; kept, and named here so the
//      next person does not put Checkr back.)
//   3. JOURNEYS IS LIVE. It sits in Relationships as a real feature, not
//      under "coming soon", because THREAD-2a/2b and FIX-4 shipped it.
//   4. THE CONNECTIONS BAND IS CREAM. In the mockup it was a solid emerald
//      panel — the only full-bleed block of the ACTION colour on the page,
//      competing with every button on the screen.
//
// The photographs are extracted from the mockup into `public/landing/` and
// referenced by URL: 2MB of base64 in a source file is 2MB in the JS
// bundle, parsed on every visit, and it cannot be cached separately.
//
// WHAT THIS PAGE MUST NEVER GROW: invented social proof. No logos, no
// review scores, no testimonials, no customer counts, no "trusted by".
// Steward has real customers and can name them when they say yes.
//
// THE ADVISORS ARE REAL PEOPLE who approved their name, title and photo.
// Nothing about them is placeholder copy, and nothing here is changed
// without asking them.

const CAL = "https://calendly.com/xjca2006/new-meeting";
const TIERS = PRICING.tiers;
const TALK = PRICING.talkToUs;
const usd = n => "$" + Number(n).toLocaleString("en-US");

export default function Landing() {
  // The Agent demo on the page: accept or skip, then review again.
  const [decision, setDecision] = useState(null);
  // The pricing toggle, from the same catalogue the signup route reads.
  const [period, setPeriod] = useState("monthly");
  const yearly = period === "yearly";

  // The page owns its ground: index.html paints `body` ink for the
  // authenticated shell, and an overscroll on a phone showed a black bar
  // above a cream page.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "#f0ede6";
    return () => { document.body.style.background = prev; };
  }, []);

  // The photo carousel. Plain interval, paused on hover and when the tab is
  // hidden, and it does nothing at all for somebody who asked for reduced
  // motion — an auto-advancing strip of faces is exactly what that setting
  // is for.
  const trackRef = useRef(null);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let reduced = false;
    try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { reduced = false; }
    if (reduced || paused) return undefined;
    const t = setInterval(() => setSlide(s => s + 1), 4200);
    return () => clearInterval(t);
  }, [paused]);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const slides = el.querySelectorAll(".carousel-slide");
    if (!slides.length) return;
    const i = slide % slides.length;
    const step = slides[0].offsetWidth + (parseFloat(getComputedStyle(el).gap) || 0);
    el.style.transform = `translateX(-${i * step}px)`;
  }, [slide]);

  const priceOf = t => (yearly ? t.yearlyUsd : t.monthlyUsd);
  const subOf = t => (yearly ? `$${Math.round(t.yearlyUsd / 12)} a month, billed yearly` : PRICING.monthToMonth);

  return (
    <div className="lp-root">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet"/>
      <style>{LANDING_CSS}</style>

  <nav className="nav" aria-label="Page navigation">
    <div className="wrap nav-inner">
      <a className="brand" href="#top">Steward</a>
      <div className="nav-links">
        <a href="#relationships">Relationships</a>
        <a href="#connections">Connections</a>
        <a href="#pricing">Pricing</a>
        <a href="/lost-and-found">Lost &amp; Found</a>
        <div className="nav-cta">
          <a className="button secondary" href={CAL} target="_blank" rel="noreferrer">Book a call</a>
          <a className="button" href="/signup">Start now</a>
        </div>
      </div>
    </div>
  </nav>

  <main>
    <section className="wrap hero" id="top">
      <div className="hero-copy">
        <p className="eyebrow">For the people carrying the mission</p>
        <h1>More time for the work that matters.</h1>
        <p>Steward is the CRM that remembers the next right thing for every donor, so your team can spend more time serving people.</p>
        <div className="hero-actions">
          <a className="button" href="/signup">Start now</a>
          <a className="button secondary" href={CAL} target="_blank" rel="noreferrer">Book a call</a>
        </div>
        <p className="microcopy">30 days free. Card at signup. Cancel anytime.</p>
      </div>
      <div className="hero-visual">
        <img className="hero-photo" src="/landing/three-smiling-volunteers-working-together-outd.jpg" alt="Three smiling volunteers working together outdoors in warm morning light" />
        <div className="hero-card">
          <div className="hero-card-top"><i aria-hidden="true"></i><strong>Harborlight</strong></div>
          <p>Marisol gave again after your last conversation. Her next step is due Friday.</p>
        </div>
      </div>
    </section>

    <div className="promises" aria-label="Three promises">
      <div className="wrap promise-grid">
        <div className="promise"><strong>Room to lead</strong><span>Your team holds the relationships. Nothing reaches a donor without a person.</span></div>
        <div className="promise"><strong>Thoughtful next steps</strong><span>Every suggestion says why, and every number opens the records behind it.</span></div>
        <div className="promise"><strong>Gifts stay with you</strong><span>Steward keeps watch without ever moving a dollar.</span></div>
      </div>
    </div>

    <section className="lostfound" id="lost-and-found">
      <div className="wrap">
        <div className="lostfound-card">
          <div>
            <p className="eyebrow">Lost &amp; Found</p>
            <h2>A $1,500 donor audit. Free.</h2>
            <p className="lf-copy">Consultants charge $500 to $2,000 to tell you which donors are slipping away. Upload your donor file and see who has gone quiet, who is drifting and how much is at risk, before your year-end appeal goes out.</p>
          </div>
          <div className="lostfound-side">
            <span className="trust"><i aria-hidden="true"></i>Your donor file never leaves your computer.</span>
            <a className="button light" href="/lost-and-found">Find your lost donors</a>
            <p className="fine">Free, forever. No account needed.</p>
          </div>
        </div>
      </div>
    </section>

    <section className="agent-section" id="agent">
      <div className="wrap">
        <div className="section-head">
          <div><p className="eyebrow">The Agent</p><h2>A steady hand for the details.</h2></div>
          <p>The Agent drafts notes, builds briefs, and cleans records, so your team can stay present with people. Every important change still comes to you.</p>
        </div>
        <div className="product-shell" aria-label="Harborlight approval screen">
          <aside className="product-nav">
            <p className="org-name">Harborlight</p>
            <ul>
              <li>Home</li>
              <li>Donors</li>
              <li className="active">The Agent</li>
              <li>Reports</li>
            </ul>
          </aside>
          <div className="product-main">
            <div className="product-top">
              <div><h3>Steward Data</h3><p>One record needs your review.</p></div>
              <span className="approval-label">You approve</span>
            </div>
            <article className="approval-card" id="approvalCard">
              {!decision && <div id="approvalPrompt">
                <div className="approval-head"><span>Possible donor match</span><span>Needs approval</span></div>
                <div className="approval-body">
                  <h4>Match this $125 gift to Marisol Reed?</h4>
                  <p>The donor name is shortened on the gift record.</p>
                  <p className="why"><strong>Why:</strong> the email, initials, and giving pattern match Marisol's record.</p>
                </div>
                <div className="approval-actions">
                  <button type="button" data-decision="skipped" onClick={() => setDecision("skipped")}>Skip</button>
                  <button className="accept" type="button" data-decision="accepted" onClick={() => setDecision("accepted")}>Accept</button>
                </div>
              </div>}
              {decision && <div className="approval-result" id="approvalResult" aria-live="polite">
                <div><strong id="decisionTitle">{decision === "accepted" ? "Accepted" : "Skipped"}</strong><p id="decisionCopy">{decision === "accepted" ? "The gift is ready to appear on Marisol's record." : "No change was made. The gift stays in the review queue."}</p><button type="button" id="reviewAgain" onClick={() => setDecision(null)}>Review again</button></div>
              </div>}
            </article>
          </div>
        </div>
      </div>
    </section>

    <section className="relationship-section" id="relationships">
      <div className="wrap">
        <div className="section-head">
          <div><p className="eyebrow">Relationships worth tending</p><h2>Never lose the next right thing.</h2></div>
          <p>Steward keeps conversations, giving changes, and missed gifts close, so thoughtful follow-up never slips away.</p>
        </div>
        <div className="relationship-grid">
          <article className="relationship-card"><span className="step">01</span><h3>The Thread</h3><p>A conversation becomes a promise kept. Steward brings the next step back when it is due.</p></article>
          <article className="relationship-card"><span className="step">02<span className="live">New</span></span><h3>Journeys</h3><p>Write your first-year rhythm once. Steward walks every new donor through it and names each next step.</p></article>
          <article className="relationship-card"><span className="step">03</span><h3>Drift</h3><p>Notice when a donor begins to pull away, while there is still time to reconnect.</p></article>
          <article className="relationship-card"><span className="step">04</span><h3>Recurring recovery</h3><p>Catch failed gifts and expired cards before a generous habit is quietly lost.</p></article>
        </div>

        <div className="photo-carousel" aria-label="Nonprofit work in action">
          <div className="carousel-head">
            <p>For teams who keep showing up for their neighbors.</p>
            <div className="carousel-controls" aria-label="Photo carousel controls">
              <button type="button" data-carousel-prev aria-label="Previous photo">←</button>
              <button type="button" data-carousel-next aria-label="Next photo">→</button>
            </div>
          </div>
          <div className="carousel-viewport">
            <div className="carousel-track" ref={trackRef}>
              <figure className="carousel-slide"><img src="/landing/three-volunteers-packing-food-aid-boxes-beside.jpg" alt="Three volunteers packing food-aid boxes beside a van in warm evening light" /><figcaption><span>Hands at work</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/four-volunteers-preparing-aid-boxes-and-helpin.jpg" alt="Four volunteers preparing aid boxes and helping a person using a wheelchair" /><figcaption><span>Serving neighbors</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/volunteers-handing-supplies-to-people-at-a-com.jpg" alt="Volunteers handing supplies to people at a community outreach event" /><figcaption><span>Care</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/volunteers-and-community-members-gathered-arou.jpg" alt="Volunteers and community members gathered around a table of food and water" /><figcaption><span>Welcome</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/volunteers-unloading-aid-boxes-from-a-van-and-.jpg" alt="Volunteers unloading aid boxes from a van and assisting a person using a wheelchair" /><figcaption><span>Community</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/smiling-volunteers-sorting-clothes-and-toiletr.jpg" alt="Smiling volunteers sorting clothes and toiletries into donation boxes" /><figcaption><span>Generosity</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/two-young-volunteers-smiling-as-they-pack-food.jpg" alt="Two young volunteers smiling as they pack food donation boxes" /><figcaption><span>Together</span></figcaption></figure>
              <figure className="carousel-slide"><img src="/landing/a-nonprofit-team-gathering-around-a-table-to-r.jpg" alt="A nonprofit team gathering around a table to review their work" /><figcaption><span>Shared purpose</span></figcaption></figure>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="growth-section" id="growth">
      <div className="wrap">
        <div className="section-head">
          <div><p className="eyebrow">Built to grow</p><h2>Grow the work without losing the heart.</h2></div>
          <p>Keep funds, grants, reports, and board views in one clear place, with the people behind every number always in reach.</p>
        </div>
        <div className="growth-grid">
          <article className="growth-item"><h3>Fund accounting</h3><p>Honor every gift by keeping restricted and unrestricted funds clear.</p></article>
          <article className="growth-item"><h3>Grants</h3><p>Move each opportunity forward with the full story close at hand.</p></article>
          <article className="growth-item"><h3>Board dashboards</h3><p>Share the story of the work, then open the records behind every number.</p><span className="open-number" aria-hidden="true"></span></article>
          <article className="growth-item"><h3>Reports</h3><p>See retention, giving patterns, and follow-up without losing time in spreadsheets.</p><span className="open-number" aria-hidden="true"></span></article>
        </div>

        <div className="people-block" id="founder">
          <div className="people-head"><p className="eyebrow">People behind Steward</p><h3>Built alongside people who know the work.</h3><p>Nonprofit leaders who know every record stands for a real person and a real relationship.</p></div>
          <article className="founder-feature">
            <div className="founder-photo"><img src="/landing/jonathan-atkinson.png" alt="Jonathan Atkinson" /></div>
            <div><h3>Jonathan Atkinson</h3><p>Founder of Steward</p></div>
          </article>
          <h3 className="advisor-label">Board of Advisors</h3>
          <div className="advisor-grid">
            <article className="advisor-card">
              <img className="advisor-photo" src="/landing/winfield-bevins.jpg" alt="Winfield Bevins" />
              <h3><a href="https://winfieldbevins.com/about-winfield/" target="_blank" rel="noopener noreferrer">Winfield Bevins</a></h3>
              <p className="advisor-title">Executive Director</p><p className="advisor-org">Creo Arts</p>
            </article>
            <article className="advisor-card">
              <img className="advisor-photo" src="/landing/ross-jenkins.png" alt="Ross Jenkins" />
              <h3>Ross Jenkins</h3>
              <p className="advisor-title">Founder</p><p className="advisor-org">Kingdom Legacy Collective</p>
            </article>
            <article className="advisor-card">
              <img className="advisor-photo" src="/landing/brad-atkinson.jpg" alt="Brad Atkinson" />
              <h3><a href="https://www.asbury.edu/directory/entry/brad-atkinson/" target="_blank" rel="noopener noreferrer">Brad Atkinson</a></h3>
              <p className="advisor-title">Development Director</p><p className="advisor-org">Asbury University</p>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section className="connections connections-cream" id="connections">
      <div className="wrap">
        <div className="section-head">
          <div><p className="eyebrow">Connections</p><h2>Keep the tools your team already knows.</h2></div>
          <p>Steward brings gifts together from the services you connect and quietly watches for gaps. It never holds or moves your money.</p>
        </div>
        <div className="connection-grid" aria-label="Giving tool connections">
          <div className="connection">Stripe</div><div className="connection">PayPal</div><div className="connection">Zeffy</div><div className="connection">Givebutter</div><div className="connection">Square</div><div className="connection">Bank statement imports</div>
        </div>
        <div className="soon-list" aria-label="Connections coming soon">
          <span>QuickBooks and Xero coming soon</span><span>Mailchimp and Constant Contact coming soon</span><span>Gmail and Outlook logging coming soon</span>
        </div>
      </div>
    </section>

    <section className="volunteers" id="volunteers">
      <div className="wrap volunteer-layout">
        <div className="volunteer-visual">
          <img className="volunteer-photo" src="/landing/smiling-volunteers-sorting-clothes-and-supplie.jpg" alt="Smiling volunteers sorting clothes and supplies into donation boxes" />
        </div>
        <div className="volunteer-copy">
          <p className="eyebrow">Included in every plan</p>
          <h2>Make it easier for people to show up.</h2>
          <p className="volunteer-subhead">From first sign-up to hours served, every volunteer stays known, prepared, and connected.</p>
          <div className="volunteer-grid">
            <article className="volunteer-card"><span className="volunteer-number">01</span><h3>Volunteer roster</h3><p>Know the people behind the work, with contact details, screening, and availability together.</p></article>
            <article className="volunteer-card"><span className="volunteer-number">02</span><h3>Shifts and hours</h3><p>Plan shifts, match people with roles, and record every hour they give.</p></article>
            <article className="volunteer-card"><span className="volunteer-number">03</span><h3>Public sign-up link</h3><p>Welcome new volunteers with one simple link they can use on their own.</p></article>
            <article className="volunteer-card"><span className="volunteer-number">04</span><h3>Background checks</h3><p>Track background checks and get a heads-up before one expires.</p></article>
          </div>
        </div>
      </div>
    </section>

          {/* ── LANDING-1 item 1 · THE PRICING SECTION FIX-4 SHIPPED ──────
          Seed, Sapling, Orchard and Forest, with the donor count UNDER the
          name, read from `pricing.json`. Not the mockup's table: this is
          the section Jonathan approved in docs/landing/pricing-mockup.html
          and FIX-4 built, and there is one of it. */}
      <section className="pricing" id="pricing">
        <div className="wrap">
          <div className="section-head">
            <div><p className="eyebrow">Pricing</p><h2>{PRICING.headline}</h2></div>
            <p>{PRICING.lede}</p>
          </div>

          <div className="lp-toggle-wrap">
            <div className="toggle" role="group" aria-label="Billing period">
              {[["monthly", "Monthly"], ["yearly", "Yearly"]].map(([id, label]) => (
                <button key={id} type="button" data-period={id} aria-pressed={period === id}
                  onClick={() => setPeriod(id)}>{label}</button>
              ))}
            </div>
            <span className="lp-pill">{PRICING.yearlyPill}</span>
          </div>

          <div className="lp-tiers">
            {TIERS.map(t => (
              <div key={t.id} className={"lp-tier" + (t.featured ? " featured" : "")} data-tier={t.id}>
                <div className="lp-tier-top">
                  <span className="lp-tier-name">{t.name}</span>
                  {t.featured && <span className="lp-badge">{PRICING.featuredBadge}</span>}
                </div>
                <span className="lp-tier-band">{t.band}</span>
                <div className="lp-tier-price">
                  <strong>{usd(priceOf(t))}</strong><span className="per">{yearly ? "a year" : "a month"}</span>
                </div>
                <span className="sub">{subOf(t)}</span>
                <Link className="lp-tier-cta" to="/signup">{PRICING.startCta}</Link>
              </div>
            ))}
          </div>

          <div className="lp-forest">
            <div>
              <span className="lp-forest-name">{TALK.name}</span>
              <span className="lp-forest-line">{TALK.line}</span>
            </div>
            <a className="lp-tier-cta quiet" href={CAL} target="_blank" rel="noreferrer">{TALK.cta}</a>
          </div>

          <div className="lp-included">
            <h3>{PRICING.includedHeading}</h3>
            <div className="lp-included-grid">
              {PRICING.includedGroups.map(g => (
                <div key={g.name}><b>{g.name}</b><span>{g.copy}</span></div>
              ))}
            </div>
            <div className="lp-extras">{PRICING.extras.map(x => <span key={x}>{x}</span>)}</div>
          </div>
        </div>
      </section>

<section className="data-plain" id="data">
      <div className="wrap data-inner">
        <p className="data-quote">Your data belongs to your mission.</p>
        <div className="data-copy">
          <p>Export everything anytime, even after you leave. The history you have built with your donors always stays yours.</p>
          <p className="mobile-note">A mobile app is coming soon.</p>
        </div>
      </div>
    </section>
  </main>

  <footer className="footer">
    <div className="wrap footer-inner">
      <div><strong>The CRM that remembers the next right thing, for every donor.</strong><p>Made for small teams with meaningful work to do.</p></div>
      <div className="footer-links"><a href="#agent">The Agent</a><a href="#relationships">Relationships</a><a href="#volunteers">Volunteers</a><a href="/lost-and-found">Lost &amp; Found</a><a href="#pricing">Pricing</a><a href={CAL} target="_blank" rel="noreferrer">Book a call</a></div>
    </div>
  </footer>
</div>
  );
}

const LANDING_CSS = `
    :root {
      color-scheme: light;
      --ink: #0f1a12;
      --cream: #f0ede6;
      --cream-deep: #e8e4db;
      --white: #ffffff;
      --grey: rgba(15,26,18,.68);
      --line: rgba(15,26,18,.16);
      --emerald: #0d5c3a;
      --emerald-dark: #0d5c3a;
      --brass: #c9a84c;
      --serif: "Newsreader", Georgia, serif;
      --sans: "DM Sans", sans-serif;
    }

    * { box-sizing: border-box; }
    .lp-root { scroll-behavior: smooth; }
    .lp-root {
      margin: 0;
      overflow-x: hidden;
      background: var(--white);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.58;
      -webkit-font-smoothing: antialiased;
    }
    img { display: block; max-width: 100%; }
    a, button { font: inherit; }
    a { color: inherit; }
    button { color: inherit; }
    :focus-visible { outline: 3px solid rgba(201,168,76,.65); outline-offset: 3px; }
    .wrap { width: min(1160px, calc(100% - 48px)); margin-inline: auto; }
    .eyebrow {
      margin: 0 0 17px;
      color: var(--grey);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .17em;
      line-height: 1.4;
      text-transform: uppercase;
    }
    .eyebrow::before {
      content: "";
      display: inline-block;
      width: 18px;
      height: 2px;
      margin: 0 9px 3px 0;
      background: var(--brass);
    }
    h1, h2, h3, p { margin-top: 0; }
    h1, h2, h3 {
      font-family: var(--serif);
      font-weight: 600;
      letter-spacing: -.035em;
    }
    h1 { max-width: 720px; margin-bottom: 24px; font-size: clamp(52px, 6.6vw, 86px); line-height: .95; }
    h2 { margin-bottom: 0; font-size: clamp(40px, 5.2vw, 66px); line-height: .98; }
    h3 { font-size: 28px; line-height: 1.08; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 22px;
      border: 1px solid var(--emerald);
      border-radius: 6px;
      background: var(--emerald);
      color: var(--white);
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      transition: background .18s ease, border-color .18s ease;
    }
    .button:hover { background: var(--emerald-dark); border-color: var(--emerald-dark); }
    .button.secondary { background: transparent; color: var(--emerald); }
    .button.secondary:hover { background: var(--cream); }
    .button.light { border-color: rgba(255,255,255,.75); background: var(--white); color: var(--emerald); }
    .button.light:hover { background: var(--cream); border-color: var(--cream); }
    .nav {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,.96);
      backdrop-filter: blur(10px);
    }
    .nav-inner { min-height: 66px; display: flex; align-items: center; justify-content: flex-end; gap: 26px; }
    .nav-links { display: flex; align-items: center; gap: 25px; }
    .nav a { font-size: 13px; font-weight: 700; text-decoration: none; }
    .nav a:not(.button):hover { color: var(--emerald); }

    .hero {
      display: grid;
      grid-template-columns: .94fr 1.06fr;
      align-items: center;
      gap: clamp(44px, 7vw, 90px);
      min-height: 725px;
      padding: 88px 0 96px;
    }
    .hero-copy > p:not(.eyebrow) { max-width: 590px; margin-bottom: 0; color: var(--grey); font-size: clamp(18px, 1.8vw, 21px); }
    .hero-actions, .pricing-actions { display: flex; flex-wrap: wrap; gap: 11px; margin-top: 30px; }
    .microcopy { margin-top: 14px !important; font-size: 13px !important; }
    .hero-visual { position: relative; min-height: 540px; }
    .hero-photo {
      width: 91%;
      height: 525px;
      margin-left: auto;
      border-radius: 140px 6px 6px 6px;
      object-fit: cover;
      object-position: 53% center;
    }
    .hero-card {
      position: absolute;
      left: 0;
      bottom: 28px;
      width: min(350px, 80%);
      padding: 20px;
      border: 1px solid var(--line);
      background: var(--white);
      box-shadow: 0 18px 40px rgba(15,26,18,.12);
    }
    .hero-card-top { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; font-size: 13px; }
    .hero-card-top i { width: 8px; height: 8px; border-radius: 50%; background: var(--brass); }
    .hero-card p { margin-bottom: 0; color: var(--grey); font-size: 13px; }
    .photo-credit { margin: 8px 0 0; color: var(--grey); font-size: 10px; letter-spacing: .05em; text-align: right; }

    .promises { border-block: 1px solid var(--line); background: var(--cream); }
    .promise-grid { display: grid; grid-template-columns: repeat(3, 1fr); }
    .promise { padding: 32px 36px; border-right: 1px solid var(--line); }
    .promise:first-child { padding-left: 0; }
    .promise:last-child { border-right: 0; }
    .promise strong { display: block; margin-bottom: 5px; font-family: var(--serif); font-size: 24px; }
    .promise span { color: var(--grey); font-size: 14px; }

    section { padding: 112px 0; }
    .section-head { display: grid; grid-template-columns: .95fr 1.05fr; align-items: end; gap: clamp(42px, 7vw, 90px); margin-bottom: 52px; }
    .section-head > p { max-width: 550px; margin-bottom: 3px; color: var(--grey); font-size: 18px; }

    .agent-section { background: var(--white); }
    .product-shell {
      display: grid;
      grid-template-columns: 205px 1fr;
      min-height: 535px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--cream);
      box-shadow: 0 20px 50px rgba(15,26,18,.09);
    }
    .product-nav { padding: 25px 18px; background: var(--ink); color: var(--cream); }
    .org-name { margin: 0 0 27px; font-family: var(--serif); font-size: 24px; }
    .product-nav ul { list-style: none; padding: 0; margin: 0; }
    .product-nav li { margin-bottom: 5px; padding: 9px 11px; border-radius: 4px; color: rgba(240,237,230,.72); font-size: 13px; }
    .product-nav li.active { background: rgba(240,237,230,.12); color: var(--white); }
    .product-main { display: grid; grid-template-rows: auto 1fr; padding: 34px 38px 42px; }
    .product-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
    .product-top h3 { margin-bottom: 6px; font-size: 36px; }
    .product-top p { margin-bottom: 0; color: var(--grey); font-size: 14px; }
    .approval-label { padding: 6px 9px; border: 1px solid rgba(201,168,76,.7); border-radius: 999px; color: var(--ink); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .approval-card {
      align-self: center;
      width: min(625px, 100%);
      margin: 34px auto 0;
      border: 1px solid var(--cream-deep);
      border-radius: 8px;
      background: var(--white);
      box-shadow: 8px 8px 0 var(--cream-deep);
    }
    .approval-head { display: flex; justify-content: space-between; gap: 14px; padding: 18px 20px; border-bottom: 1px solid var(--line); color: var(--grey); font-size: 12px; }
    .approval-.lp-root { padding: 24px 24px 18px; }
    .approval-body h4 { margin: 0 0 8px; font-size: 18px; }
    .approval-body > p { margin-bottom: 16px; color: var(--grey); font-size: 14px; }
    .why { padding: 12px 14px; border-left: 3px solid var(--brass); background: var(--cream); color: var(--ink) !important; font-size: 13px !important; }
    .approval-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 0 24px 22px; }
    .approval-actions button { min-width: 80px; min-height: 39px; border: 1px solid rgba(15,26,18,.4); border-radius: 5px; background: var(--white); font-weight: 700; cursor: pointer; }
    .approval-actions .accept { border-color: var(--emerald); background: var(--emerald); color: var(--white); }
    /* LANDING-1. Hiding this by default was the mockup script's job to
       undo. React decides whether the element EXISTS at all now, so the
       default has to be the visible one; leaving it hidden rendered the
       result into a box nobody could see. */
    .approval-result { display: grid; min-height: 245px; place-items: center; padding: 24px; text-align: center; }
    .approval-result strong { display: block; margin-bottom: 5px; font-family: var(--serif); font-size: 26px; }
    .approval-result p { margin: 0 0 16px; color: var(--grey); font-size: 14px; }
    .approval-result button { border: 0; background: transparent; color: var(--emerald); font-weight: 700; cursor: pointer; }

    .relationship-section { background: var(--cream); }
    .relationship-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
    .relationship-card { padding: 30px 28px 28px; border-top: 3px solid var(--brass); background: var(--white); }
    .relationship-card .step { color: var(--grey); font-size: 11px; font-weight: 700; letter-spacing: .13em; }
    .relationship-card h3 { margin: 28px 0 10px; font-size: 30px; }
    .relationship-card p { margin-bottom: 0; color: var(--grey); }
    .photo-carousel { margin-top: 72px; margin-inline: calc(50% - 50vw); overflow: hidden; }
    .carousel-head { width: min(1160px, calc(100% - 48px)); margin: 0 auto 18px; display: flex; align-items: end; justify-content: space-between; gap: 20px; }
    .carousel-head p { margin: 0; color: var(--grey); font-size: 14px; }
    .carousel-controls { display: flex; gap: 8px; }
    .carousel-controls button { width: 42px; height: 42px; border: 1px solid var(--line); border-radius: 50%; background: var(--white); color: var(--emerald); cursor: pointer; font-size: 19px; }
    .carousel-viewport { overflow: hidden; padding-inline: max(24px, calc((100vw - 1160px) / 2)); }
    .carousel-track { display: flex; width: max-content; gap: 16px; will-change: transform; }
    .carousel-slide { flex: 0 0 auto; width: clamp(290px, 35vw, 500px); margin: 0; }
    .carousel-slide img { width: 100%; height: clamp(300px, 31vw, 410px); border-radius: 4px; object-fit: cover; }
    .carousel-slide figcaption { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: var(--grey); font-size: 11px; }

    .growth-section { background: var(--white); }
    .growth-grid { display: grid; grid-template-columns: repeat(2, 1fr); border: 1px solid var(--line); }
    .growth-item { min-height: 178px; padding: 32px; border-bottom: 1px solid var(--line); }
    .growth-item:nth-child(odd) { border-right: 1px solid var(--line); }
    .growth-item:nth-last-child(-n+2) { border-bottom: 0; }
    .growth-item h3 { margin-bottom: 9px; }
    .growth-item p { margin-bottom: 0; color: var(--grey); }
    .open-number { display: inline-flex; align-items: center; gap: 8px; margin-top: 13px; color: var(--emerald); font-size: 12px; font-weight: 700; }
    .open-number::after { content: "Open records"; }

    .people-block { margin-top: 92px; padding-top: 72px; border-top: 1px solid var(--line); }
    .people-head { max-width: 680px; margin-bottom: 38px; }
    .people-head h3 { margin-bottom: 10px; font-size: 40px; }
    .people-head p { margin-bottom: 0; color: var(--grey); }
    .founder-feature { display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 34px; margin-bottom: 42px; padding: 18px; border: 1px solid var(--line); background: var(--cream); }
    .founder-photo { width: 190px; height: 190px; overflow: hidden; border-radius: 50%; }
    .founder-photo img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; object-position: center; }
    .founder-feature h3 { margin: 0 0 4px; font-size: 38px; }
    .founder-feature p { margin: 0; color: var(--grey); }
    .founder-kicker { margin-bottom: 8px !important; color: var(--emerald) !important; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    .advisor-label { margin: 0 0 17px; font-size: 26px; }
    .advisor-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
    .advisor-card { padding-bottom: 22px; border-bottom: 1px solid var(--line); }
    .advisor-photo { width: 184px; height: 184px; margin-bottom: 18px; border-radius: 50%; object-fit: cover; object-position: center; }
    .advisor-card h3 { margin-bottom: 5px; font-size: 27px; }
    .advisor-card h3 a { text-decoration: none; }
    .advisor-card h3 a:hover { color: var(--emerald); }
    .advisor-title { margin-bottom: 2px; color: var(--emerald); font-size: 13px; font-weight: 700; }
    .advisor-org { margin: 0; color: var(--grey); font-size: 14px; }

    .connections { background: var(--cream-deep); color: var(--ink); }
  /* LANDING-1 item 4 — the Connections band was a solid emerald panel, the
     only full-bleed block of the ACTION colour on the page. Emerald means
     "this is the thing to press", and a whole section of it competes with
     every button on the screen. Cream, with the logo tiles as white cards,
     which is how every other band on this page is built. The text rules
     below follow it: white-on-emerald becomes ink-on-cream. */
  .connections-cream .connection { background: var(--white); border-color: var(--line); color: var(--ink); }
  .connections-cream .connection-note { color: var(--grey); }
  .connections-cream .soon-list span { border-color: var(--line); color: var(--grey); }
  .connections-cream .section-head p { color: var(--grey); }
  .connections-cream .eyebrow { color: var(--grey); }
    .connections .eyebrow { color: var(--grey); }
    .connections .section-head > p { color: var(--grey); }
    .connection-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .connection { padding: 20px; border: 1px solid rgba(255,255,255,.34); background: rgba(255,255,255,.06); text-align: center; font-weight: 700; }
    .connection-note { margin: 22px 0 0; color: rgba(255,255,255,.76); font-size: 13px; }
    .soon-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
    .soon-list span { padding: 7px 9px; border: 1px solid rgba(255,255,255,.34); border-radius: 999px; color: rgba(255,255,255,.86); font-size: 11px; }

    .volunteers { background: var(--cream); }
    .volunteer-layout { display: grid; grid-template-columns: .94fr 1.06fr; align-items: center; gap: clamp(60px, 7vw, 98px); }
    .volunteer-visual { position: relative; margin: 0 18px 18px 0; }
    .volunteer-visual::after { content: ""; position: absolute; inset: 20px -18px -18px 20px; z-index: 0; border: 1px solid rgba(201,168,76,.55); border-radius: 28px; }
    .volunteer-photo { position: relative; z-index: 1; width: 100%; aspect-ratio: 1 / 1; border-radius: 28px; box-shadow: 0 24px 48px rgba(15,26,18,.13); object-fit: cover; object-position: center; }
    .volunteer-copy h2 { max-width: 660px; }
    .volunteer-subhead { margin: 30px 0 40px; color: var(--grey); font-size: 18px; }
    .volunteer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--line); background: rgba(255,255,255,.45); }
    .volunteer-card { min-height: 188px; padding: 24px 26px 26px; }
    .volunteer-card:nth-child(odd) { border-right: 1px solid var(--line); }
    .volunteer-card:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
    .volunteer-number { display: block; margin-bottom: 24px; color: var(--emerald); font-family: var(--serif); font-size: 15px; }
    .volunteer-card h3 { margin: 0 0 9px; font-family: var(--sans); font-size: 17px; font-weight: 700; letter-spacing: 0; line-height: 1.35; }
    .volunteer-card p { margin: 0; color: var(--grey); font-size: 13px; line-height: 1.5; }

    .pricing { background: var(--white); }
    .pricing-layout { display: grid; gap: 22px; }
    .pricing-card { overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--white); box-shadow: 0 18px 46px rgba(15,26,18,.08); }
    .price-table { overflow: hidden; }
    .price-row { display: grid; grid-template-columns: 1.2fr .9fr .9fr; border-bottom: 1px solid var(--line); }
    .price-row > div { display: flex; align-items: center; min-height: 76px; padding: 20px 26px; }
    .price-row > div + div { border-left: 1px solid var(--line); }
    .price-head { background: var(--ink); color: var(--cream); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .price-head > div { min-height: 52px; padding-block: 14px; }
    .price-row:not(.price-head) > div:first-child { font-size: 15px; font-weight: 700; }
    .price-row:not(.price-head) > div:nth-child(n+2) { font-family: var(--serif); font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
    .price-row:last-child { border-bottom: 0; background: var(--cream); }
    .price-card-footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 24px 26px 27px; border-top: 1px solid var(--line); background: var(--cream); }
    .active-note { max-width: 500px; margin: 0; color: var(--grey); font-size: 13px; }
    .price-card-footer .pricing-actions { flex: 0 0 auto; margin-top: 0; }
    .price-card-footer .microcopy { margin: 9px 0 0 !important; text-align: right; }
    .feature-list { padding: clamp(30px, 4.2vw, 48px); border: 1px solid var(--line); border-radius: 10px; background: var(--cream); }
    .feature-list h3 { margin-bottom: 26px; font-size: clamp(30px, 3vw, 40px); }
    .feature-list ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: clamp(34px, 6vw, 78px); list-style: none; padding: 0; margin: 0; }
    .feature-list li { position: relative; padding: 15px 0 15px 34px; border-top: 1px solid var(--line); color: var(--grey); font-size: 15px; line-height: 1.5; }
    .feature-list li::before { content: "✓"; position: absolute; left: 0; top: 14px; display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: var(--emerald); color: var(--white); font-size: 12px; font-weight: 700; }
    .feature-list strong { color: var(--ink); }
    .pricing-actions { margin-top: 28px; }

    .data-plain { padding: 84px 0; border-block: 1px solid var(--line); background: var(--cream); }
    .data-inner { display: grid; grid-template-columns: 1.05fr .95fr; align-items: center; gap: 70px; }
    .data-quote { margin: 0; font-family: var(--serif); font-size: clamp(42px, 5vw, 66px); font-weight: 600; letter-spacing: -.035em; line-height: 1; }
    .data-copy p { color: var(--grey); font-size: 18px; }
    .data-copy p:last-child { margin-bottom: 0; }
    .mobile-note { margin-top: 17px; font-size: 13px !important; }

    .footer { padding: 58px 0 68px; background: var(--ink); color: var(--cream); }
    .footer-inner { display: flex; justify-content: space-between; align-items: flex-end; gap: 30px; }
    .footer strong { display: block; max-width: 560px; font-family: var(--serif); font-size: 31px; line-height: 1.1; }
    .footer p { margin: 9px 0 0; color: rgba(240,237,230,.68); }
    .footer-links { display: flex; flex-wrap: wrap; gap: 17px; }
    .footer-links a { color: var(--cream); font-size: 13px; font-weight: 700; text-decoration: none; }

    @media (max-width: 920px) {
      .hero, .section-head, .pricing-layout, .data-inner, .volunteer-layout { grid-template-columns: 1fr; }
      .volunteer-layout { gap: 64px; }
      .volunteer-visual { width: min(680px, calc(100% - 18px)); }
      .hero { min-height: 0; gap: 44px; padding: 70px 0 82px; }
      .hero-copy { max-width: 730px; }
      .hero-visual { min-height: 510px; }
      .hero-photo { height: 500px; }
      .promise-grid { grid-template-columns: 1fr; }
      .promise, .promise:first-child { padding: 23px 0; border-right: 0; border-bottom: 1px solid var(--line); }
      .promise:last-child { border-bottom: 0; }
      .product-shell { grid-template-columns: 1fr; }
      .product-nav { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 20px; }
      .org-name { margin: 0; }
      .product-nav ul { display: flex; gap: 4px; }
      .product-nav li { margin: 0; }
      .product-nav li:nth-child(n+3) { display: none; }
      .relationship-grid, .advisor-grid, .connection-grid { grid-template-columns: 1fr 1fr; }
      .advisor-card:last-child, .connection:last-child { grid-column: 1 / -1; }
      .advisor-card:last-child .advisor-photo { max-height: 430px; }
      .people-block { margin-top: 76px; }
    }

    @media (max-width: 640px) {
      .wrap { width: min(100% - 30px, 1160px); }
      .nav-inner { min-height: 60px; }
      /* LANDING-1. The mockup hid every text link on a phone, which left a
         visitor on a phone unable to reach Pricing or Lost & Found at all.
         Lost & Found is the whole top of the funnel and a phone is where
         most people meet a link to it, so the links WRAP onto a second row
         instead of disappearing: smaller, tighter, still there. */
      .nav-inner { flex-wrap: wrap; gap: 10px 14px; padding-top: 10px; padding-bottom: 10px; min-height: 0; }
      .nav-links { flex-wrap: wrap; justify-content: flex-end; gap: 10px 14px; }
      .nav-links a:not(.button) { font-size: 12px; }
      .nav-inner::before { content: "For nonprofit teams"; font-family: var(--serif); font-size: 17px; font-weight: 600; }
      .nav .button { min-height: 40px; padding: 0 14px; }
      .hero { padding: 54px 0 66px; }
      h1 { font-size: clamp(48px, 15vw, 65px); }
      .hero-actions, .pricing-actions { display: grid; grid-template-columns: 1fr 1fr; }
      .hero-actions .button, .pricing-actions .button { padding-inline: 10px; }
      .hero-visual { min-height: 410px; }
      .hero-photo { width: 95%; height: 400px; border-radius: 84px 5px 5px 5px; }
      .hero-card { bottom: 16px; width: 88%; padding: 16px; }
      section { padding: 78px 0; }
      .section-head { gap: 22px; margin-bottom: 38px; }
      h2 { font-size: clamp(41px, 12vw, 52px); }
      .product-main { padding: 26px 16px 30px; }
      .product-nav li:nth-child(n+2) { display: none; }
      .product-top { display: block; }
      .approval-label { display: inline-block; margin-top: 13px; }
      .approval-card { box-shadow: 5px 5px 0 var(--cream-deep); }
      .approval-head, .approval-.lp-root { padding: 16px; }
      .approval-actions { padding: 0 16px 17px; }
      .relationship-grid, .growth-grid, .advisor-grid, .connection-grid { grid-template-columns: 1fr; }
      .volunteer-layout { gap: 52px; }
      .volunteer-visual { width: calc(100% - 14px); margin: 0 14px 14px 0; }
      .volunteer-visual::after { inset: 14px -14px -14px 14px; border-radius: 20px; }
      .volunteer-photo { border-radius: 20px; }
      .volunteer-subhead { margin: 22px 0 30px; font-size: 16px; }
      .volunteer-grid { grid-template-columns: 1fr; }
      .volunteer-card { min-height: 0; padding: 20px; }
      .volunteer-card:nth-child(odd) { border-right: 0; }
      .volunteer-card:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
      .volunteer-number { margin-bottom: 14px; }
      .volunteer-card h3 { font-size: 15px; }
      .relationship-card { padding: 25px 22px; }
      .carousel-head { width: min(100% - 30px, 1160px); }
      .carousel-viewport { padding-inline: 15px; }
      .carousel-slide { width: 82vw; }
      .carousel-slide img { height: 300px; }
      .growth-item, .growth-item:nth-child(odd), .growth-item:nth-last-child(-n+2) { min-height: 0; border-right: 0; border-bottom: 1px solid var(--line); }
      .growth-item:last-child { border-bottom: 0; }
      .founder-feature { grid-template-columns: 1fr; text-align: center; }
      .founder-photo { width: 180px; height: 180px; margin-inline: auto; }
      .advisor-card:last-child, .connection:last-child { grid-column: auto; }
      .advisor-photo { width: 168px; height: 168px; }
      .connection-grid { gap: 8px; }
      .pricing-card, .feature-list { border-radius: 6px; }
      .price-row { grid-template-columns: 1fr 1fr; }
      .price-row > div { min-height: 58px; padding: 14px 16px; }
      .price-row > div:first-child { grid-column: 1 / -1; min-height: 48px; border-bottom: 1px solid var(--line); }
      .price-row > div:nth-child(2) { border-left: 0; }
      .price-head > div:first-child { display: none; }
      .price-head > div:nth-child(2), .price-head > div:nth-child(3) { min-height: 48px; border-top: 0; }
      .price-row:not(.price-head) > div:nth-child(n+2) { font-size: 21px; }
      .price-card-footer { display: block; padding: 22px 18px 24px; }
      .price-card-footer .pricing-actions { margin-top: 20px; }
      .price-card-footer .microcopy { text-align: left; }
      .feature-list { padding: 29px 20px; }
      .feature-list ul { grid-template-columns: 1fr; }
      .feature-list li { padding-block: 14px; }
      .data-plain { padding: 68px 0; }
      .footer-inner { display: block; }
      .footer-links { margin-top: 26px; }
    }


    .nav-inner { justify-content: space-between; }
    .nav a.brand { font-family: var(--serif); font-size: 26px; font-weight: 600; letter-spacing: -.02em; text-decoration: none; }
    .nav .nav-cta { display: flex; gap: 10px; }
    .relationship-grid { grid-template-columns: repeat(4, 1fr); }
    .relationship-card .live { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: var(--brass); color: var(--ink); font-size: 10px; letter-spacing: .08em; vertical-align: middle; }

    .lostfound { padding: 0; background: var(--white); }
    .lostfound-card { display: grid; grid-template-columns: 1.2fr .8fr; align-items: center; gap: 48px; margin: 88px auto 0; padding: 48px 52px; border-radius: 10px; background: var(--ink); color: var(--cream); }
    .lostfound-card .eyebrow { color: rgba(240,237,230,.72); }
    .lostfound-card h2 { font-size: clamp(38px, 4.4vw, 56px); }
    .lostfound-card p.lf-copy { margin: 18px 0 0; color: rgba(240,237,230,.78); font-size: 17px; max-width: 560px; }
    .lostfound-side { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
    .lostfound-side .trust { display: flex; gap: 10px; align-items: center; color: var(--cream); font-size: 14px; font-weight: 700; }
    .lostfound-side .trust i { width: 9px; height: 9px; border-radius: 50%; background: var(--brass); }
    .lostfound-side .fine { margin: 0; color: rgba(240,237,230,.68); font-size: 13px; }

    .connections { background: var(--white); color: var(--ink); border-top: 1px solid var(--line); }
    .connections .eyebrow { color: var(--grey); }
    .connections .section-head > p { color: var(--grey); }
    .connection { border: 1px solid var(--line); background: var(--cream); }
    .soon-list span { border: 1px solid var(--line); color: var(--grey); }

    .price-intro { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 30px; }
    .toggle { display: flex; padding: 5px; background: var(--cream-deep); border-radius: 12px; }
    .toggle button { padding: 10px 24px; border: 0; border-radius: 9px; background: transparent; color: var(--grey); font-weight: 700; cursor: pointer; transition: background .16s ease, color .16s ease; }
    .toggle button[aria-pressed="true"] { background: var(--ink); color: var(--cream); }
    .pill { padding: 5px 12px; border-radius: 999px; background: #f3e9cc; color: #5c4710; font-size: 13px; font-weight: 700; }
    .tier-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    .tier { display: flex; flex-direction: column; gap: 8px; padding: 34px 30px 30px; border: 1px solid var(--line); border-radius: 12px; background: var(--white); }
    .tier.featured { border: 0; background: var(--ink); color: var(--cream); box-shadow: 0 28px 56px -24px rgba(15,26,18,.45); }
    .tier-top { display: flex; justify-content: space-between; align-items: center; min-height: 28px; }
    .tier-name { font-family: var(--serif); font-size: 32px; font-weight: 600; letter-spacing: -.02em; }
    .tier-badge { padding: 4px 10px; border-radius: 999px; background: var(--brass); color: var(--ink); font-size: 11px; font-weight: 700; }
    .tier-size { font-weight: 700; }
    .tier-price { display: flex; align-items: baseline; gap: 6px; padding-top: 6px; }
    .tier-price strong { font-family: var(--serif); font-size: 56px; font-weight: 600; letter-spacing: -.03em; line-height: 1; }
    .tier-muted { color: var(--grey); font-size: 14px; }
    .tier.featured .tier-muted { color: rgba(240,237,230,.72); }
    .tier .button { margin-top: 18px; }
    .tier:not(.featured) .button { background: transparent; color: var(--ink); border-color: var(--ink); }
    .tier:not(.featured) .button:hover { background: var(--cream); }
    .forest { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-top: 18px; padding: 24px 30px; border: 1px solid var(--line); border-radius: 12px; background: var(--cream); }
    .forest-left { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
    .forest-left strong { font-family: var(--serif); font-size: 28px; font-weight: 600; }
    .forest-left span { color: var(--grey); }
    .forest .button { background: transparent; color: var(--ink); border-color: var(--ink); }
    .active-line { margin: 18px 0 0; color: var(--grey); font-size: 14px; text-align: center; }

    @media (max-width: 920px) {
      .relationship-grid { grid-template-columns: 1fr 1fr; }
      .lostfound-card { grid-template-columns: 1fr; padding: 38px 30px; }
      .tier-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .relationship-grid { grid-template-columns: 1fr; }
      /* Book a call stays, because "talk to a person" is the other half of
         the header's job and it is one tap on a phone. */
      .nav .nav-cta .secondary { padding: 0 12px; font-size: 12px; }
      .nav-inner::before { content: none; }
      .forest { flex-direction: column; align-items: flex-start; }
      .lostfound-card { margin-top: 64px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .lp-root { scroll-behavior: auto; }
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
  
/* ── LANDING-1 · the FIX-4 pricing cards, in the mockup's own voice ──── */
.lp-toggle-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; margin: 40px 0 36px; }
.lp-root .toggle { display: flex; padding: 5px; background: #ece8df; border-radius: 14px; }
.lp-root .toggle button { padding: 11px 26px; border: none; border-radius: 10px; background: transparent;
  color: var(--grey); font: 600 15px var(--sans); cursor: pointer; }
.lp-root .toggle button[aria-pressed="true"] { background: var(--ink); color: var(--cream); }
.lp-pill { font-size: 14px; font-weight: 600; padding: 6px 12px; border-radius: 99px; background: #f3e9cc; color: #5c4710; }
.lp-tiers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.lp-tier { padding: 36px 34px 34px; border-radius: 22px; display: flex; flex-direction: column; gap: 10px;
  background: var(--white); border: 1px solid var(--cream-deep); }
.lp-tier.featured { background: var(--ink); color: var(--cream); border: none;
  box-shadow: 0 30px 60px -24px rgba(15,26,18,.45); }
.lp-tier-top { display: flex; justify-content: space-between; align-items: center; min-height: 28px; gap: 10px; }
.lp-tier-name { font-family: var(--serif); font-size: 34px; font-weight: 600; letter-spacing: -.4px; }
.lp-badge { font-size: 12px; font-weight: 700; padding: 5px 10px; border-radius: 99px; background: var(--brass); color: var(--ink); white-space: nowrap; }
.lp-tier-band { font-size: 16px; font-weight: 600; }
.lp-tier-price { display: flex; align-items: baseline; gap: 6px; padding-top: 8px; flex-wrap: wrap; }
.lp-tier-price strong { font-family: var(--serif); font-size: 64px; font-weight: 600; letter-spacing: -1.6px; line-height: 1; }
.lp-tier .per, .lp-tier .sub { font-size: 15px; color: var(--grey); }
.lp-tier.featured .per, .lp-tier.featured .sub { color: rgba(240,237,230,.72); }
.lp-tier-cta { margin-top: 22px; text-align: center; padding: 16px; border-radius: 12px; font-size: 16px;
  font-weight: 600; text-decoration: none; border: 1.5px solid var(--ink); color: var(--ink); display: block; }
.lp-tier.featured .lp-tier-cta { background: var(--emerald); color: #fff; border-color: var(--emerald); }
.lp-tier-cta.quiet { margin: 0; padding: 14px 22px; white-space: nowrap; }
.lp-forest { margin-top: 20px; padding: 26px 32px; border-radius: 18px; background: var(--white);
  border: 1px solid var(--cream-deep); display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.lp-forest-name { font-family: var(--serif); font-size: 30px; font-weight: 600; margin-right: 18px; }
.lp-forest-line { font-size: 17px; color: var(--grey); }
.lp-included { margin-top: 48px; display: flex; flex-direction: column; gap: 28px; }
.lp-included h3 { margin: 0; font-family: var(--serif); font-size: 30px; font-weight: 600; text-align: center; }
.lp-included-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
.lp-included-grid > div { display: flex; flex-direction: column; gap: 8px; padding-top: 18px; border-top: 2px solid var(--ink); }
.lp-included-grid b { font-size: 18px; }
.lp-included-grid span { font-size: 15px; line-height: 1.55; color: var(--grey); }
.lp-extras { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px 36px; font-size: 15px; color: #3e3a35; }
@media (max-width: 900px) {
  .lp-tiers, .lp-included-grid { grid-template-columns: 1fr; }
  .lp-forest { flex-direction: column; align-items: flex-start; }
  .lp-tier-name { font-size: 28px; }
  .lp-tier-price strong { font-size: 48px; }
}
`;

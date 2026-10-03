// LANDING-2 · the shell every marketing page shares: the header with the three
// mega menus (Platform, Why Steward, Resources) plus Pricing, the mobile
// drawer, and the five-column footer. Markup and classes are the reference's,
// so site.css draws them exactly as docs/landing/steward-site.html does.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import "./site.css";
import "./content.css";
import { A, Arrow, Icon, Photo, useHead } from "./lib";
import { PAGES } from "./pages";
import { OPEN_API_HREF } from "./data/features";
import { copyrightLine, LEGAL_ENTITY_ADDRESS, LEGAL_ENTITY_STATE } from "../../../shared/legalEntity.js";

const FONTS = "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Serif+Display:ital@0;1&display=swap";
// The marketing ground is white. index.html paints body ink for the app, so
// the site takes the ground while it is mounted and gives it back after.
const GROUND = "#FFFFFF";

const Chevron = () => <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;

function Mi({ href, icon, b, span, style }) {
  return <A className="mi" href={href} style={style}><Icon k={icon} /><div><b>{b}</b>{span && <span>{span}</span>}</div></A>;
}

const FEATURE_MENU = [["/features/drift", "drift", "Drift and retention"], ["/features/major-gifts", "major", "Major gifts"], ["/features/forms", "forms", "Donation forms"], ["/features/p2p", "p2p", "Peer-to-peer fundraising"], ["/features/reports", "reports", "Reporting and analytics"], ["/features/grants", "grants", "Grant management"], ["/features/events", "events", "Events and seating"], ["/features/memberships", "members", "Membership management"], ["/features/journeys", "journeys", "Journeys"], ["/features/inbox", "inbox", "Inbox logging"], ["/features/audit", "audit", "Audit log and security"], ["/features/import", "import", "Data import and cleanup"], ["/features/finance", "finance", "Finance and month end"], ["/features/receipts", "receipts", "Receipts and statements"]];

function MegaPlatform() {
  return (
    <div className="wrap mega-in mega-plat">
      <div className="col">
        <h5>The Steward Platform</h5>
        <Mi href="/platform" icon="home" b="Platform overview" span="One calm place for donors, gifts, events and volunteers." />
        <Mi href="/agent" icon="spark" b="Steward Agent" span="Say what you need. Approve the plan. Done." />
        <Mi href="/connections" icon="link" b="Connections" span="Keep your giving tools. Steward watches every one." />
        <Mi href="/onboarding" icon="help" b="Onboarding and support" span="Your move done with you, and a person who answers." />
      </div>
      <div className="col">
        <h5>Products</h5>
        <Mi href="/crm" icon="people" b="Steward CRM" span="Keep more donors by seeing drift while a call still fixes it." />
        <Mi href="/volunteer" icon="hand" b="Steward Volunteer" span="Shifts, hours and waivers, on the same record as giving." />
        <Mi href="/agent" icon="spark1" b="Steward Agent" span="Does the work you ask, after your yes. Never sends." />
      </div>
      <div className="col rule">
        <h5>Features</h5>
        <div className="feat2">{FEATURE_MENU.map(f => <Mi key={f[0]} href={f[0]} icon={f[1]} b={f[2]} />)}</div>
      </div>
      <div className="promo">
        <div className="art"><div className="t">The first-year<br /><b>Retention</b><br />Plan</div><small>A guide for small development teams</small><span className="leaf"></span></div>
        <h6>Keep the donors who gave for the first time this year.</h6>
        <A className="go" href="/guides/first-year-retention">Read the guide <Arrow /></A>
      </div>
    </div>
  );
}

function MegaWhy() {
  return (
    <div className="wrap mega-in mega-why">
      <div className="col">
        <h5>Why Steward</h5>
        <Mi href="/why" icon="reports" b="The case for retention" span="What the research says about donors who drift." />
        <Mi href="/move" icon="move" b="Moving to Steward" span="About a day of your time, matched to the cent." />
        <Mi href="/pricing" icon="tag" b="Honest pricing" span="Published prices, month to month, no platform fee." />
        <Mi href="/security" icon="shield" b="Security and trust" span="What we protect, and how. Only what's true." />
      </div>
      <div className="col">
        <h5>Who it's for</h5>
        <Mi href="/for/human-services" icon="building" b="Human services and missions" span="Pantries, shelters, recovery, rescue missions." />
        <Mi href="/for/pregnancy" icon="heart" b="Pregnancy and family centers" span="Keep client systems. Use Steward for donors." />
        <Mi href="/for/animal" icon="animal" b="Animal and equine programs" span="Rescues, therapeutic riding, sanctuaries." />
        <Mi href="/for/youth" icon="youth" b="Youth and mentoring" span="Mentors, families and sponsors." />
      </div>
      <div className="col">
        <h5>Company</h5>
        <Mi href="/about" icon="person" b="About Steward" span="Built in Wilmore, Kentucky, for small shops." />
        <Mi href="/leadership" icon="people" b="Leadership" span="The founder and advisors behind Steward." />
        <Mi href="/partners" icon="pair" b="Partners and consultants" span="Bring Steward to the nonprofits you advise." />
      </div>
      <div className="promo">
        <Photo k="mega-laptops" cls="wide" style={{ borderRadius: 4 }} />
        <h6>Moving from another system? We'll do the move with you.</h6>
        <A className="go" href="/move">See how it works <Arrow /></A>
      </div>
    </div>
  );
}

function MegaResources() {
  const tool = { alignItems: "start" };
  return (
    <div className="wrap mega-in mega-res">
      <div className="col">
        <h5>Learn</h5>
        <Mi href="/guides" icon="book" b="Guides" />
        <Mi href="/templates" icon="doc" b="Templates" />
        <Mi href="/articles" icon="article" b="Articles" />
        <Mi href="/glossary" icon="gloss" b="Nonprofit glossary" />
      </div>
      <div className="col">
        <h5>Help</h5>
        <Mi href="/faq" icon="help" b="FAQ" />
        <Mi href="/help" icon="chat" b="Help centre" />
        <Mi href={OPEN_API_HREF} icon="code" b="Developers and API" />
        <Mi href="/whats-new" icon="clock" b="What's new" />
      </div>
      <div className="col rule">
        <h5>Free tools</h5>
        <div className="feat2">
          <Mi href="/tools/lost-and-found" icon="search" b="Lost & Found donor audit" span="See who you're about to lose. Runs in your browser." style={tool} />
          <Mi href="/tools/retention" icon="calc" b="Keep Rate calculator" span="Your retention rate, and what a few points are worth." style={tool} />
          <Mi href="/tools/lapsed-cost" icon="trend" b="Lapse Ledger" span="What last year's lapsed donors used to give." style={tool} />
          <Mi href="/tools/thermometer" icon="therm" b="Goal Gauge" span="A campaign goal bar for your website." style={tool} />
        </div>
      </div>
      <div className="promo">
        <div className="art" style={{ background: "var(--emerald)" }}><div className="t">See who you're<br /><b style={{ color: "var(--white)" }}>About to lose</b></div><small>Free, no signup, nothing uploaded</small></div>
        <h6>Run Lost & Found on your own giving export in about a minute.</h6>
        <A className="go" href="/tools/lost-and-found">Run the free audit <Arrow /></A>
      </div>
    </div>
  );
}

// LANDING-3 · our own words, not the ones every other donor CRM uses.
// Product, Why switch, Pricing,
// Leadership, Learn. Only the top-level words changed: every menu holds
// exactly what it held before.
const MEGAS = [["plat", "Product", MegaPlatform], ["why", "Why switch", MegaWhy], ["res", "Learn", MegaResources]];

const DRAWER = [
  ["Product", [["/platform", "Platform overview"], ["/crm", "Steward CRM"], ["/volunteer", "Steward Volunteer"], ["/agent", "Steward Agent"], ["/connections", "Connections"], ["/onboarding", "Onboarding and support"], ["/features", "All features"]]],
  ["Why switch", [["/why", "The case for retention"], ["/move", "Moving to Steward"], ["/for", "Who it's for"], ["/security", "Security and trust"], ["/about", "About"], ["/leadership", "Leadership"], ["/partners", "Partners"]]],
  ["Learn", [["/guides", "Guides"], ["/templates", "Templates"], ["/articles", "Articles"], ["/glossary", "Glossary"], ["/research", "Research"], ["/tools", "Free tools"], ["/faq", "FAQ"], ["/help", "Help centre"]]],
];

function Header() {
  const [open, setOpen] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [shadow, setShadow] = useState(false);
  const ref = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => { setOpen(null); setDrawer(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setShadow(window.scrollY > 4);
    const onKey = e => { if (e.key === "Escape") { setOpen(null); setDrawer(false); } };
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    onScroll();
    return () => { window.removeEventListener("scroll", onScroll); document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, []);
  // A click on any link inside an open panel closes it, even when the link is
  // to the page already showing.
  const closeOnLink = e => { if (e.target.closest("a")) { setOpen(null); setDrawer(false); } };

  return (
    <header className={"hdr" + (shadow ? " shadow" : "")} ref={ref}>
      <div className="wrap bar">
        <A className="word" href="/" aria-label="Steward home">Steward</A>
        <ul className="menu" role="list">
          {MEGAS.slice(0, 2).map(([id, label]) => (
            <li key={id}><button type="button" aria-expanded={open === id ? "true" : "false"} aria-controls={"m-" + id} onClick={() => setOpen(open === id ? null : id)}>{label} <Chevron /></button></li>
          ))}
          <li><A href="/pricing">Pricing</A></li>
          <li><A href="/leadership">Leadership</A></li>
          <li><button type="button" aria-expanded={open === "res" ? "true" : "false"} aria-controls="m-res" onClick={() => setOpen(open === "res" ? null : "res")}>Learn <Chevron /></button></li>
        </ul>
        <div className="right">
          <A className="login" href="/login">Log in</A>
          <A className="pill pill-ink" href="/demo"><i></i>Book a call</A>
          <button className="burger" type="button" aria-label="Open menu" aria-expanded={drawer ? "true" : "false"} aria-controls="drawer" onClick={() => setDrawer(!drawer)}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      {MEGAS.map(([id, , Panel]) => (
        <div className="mega" id={"m-" + id} key={id} hidden={open !== id} onClick={closeOnLink}><Panel /></div>
      ))}
      <div className="drawer" id="drawer" hidden={!drawer} onClick={closeOnLink}>
        {DRAWER.map(([label, items]) => (
          <details key={label}><summary>{label}</summary>{items.map(([h, b]) => <A className="mi" href={h} key={h}><span></span><div><b>{b}</b></div></A>)}</details>
        ))}
        <details><summary><A href="/pricing" style={{ textDecoration: "none" }}>Pricing</A></summary></details>
        <details><summary><A href="/leadership" style={{ textDecoration: "none" }}>Leadership</A></summary></details>
        <p style={{ marginTop: 26 }}><A href="/login" style={{ fontWeight: 600 }}>Log in</A></p>
      </div>
    </header>
  );
}

const FOOTER = [
  ["Product", [["/platform", "Platform overview"], ["/crm", "Steward CRM"], ["/volunteer", "Steward Volunteer"], ["/agent", "Steward Agent"], ["/connections", "Connections"], ["/features", "All features"], ["/pricing", "Pricing"]]],
  ["Learn", [["/why", "The case for retention"], ["/articles", "Articles"], ["/guides", "Guides"], ["/templates", "Templates"], ["/research", "Research"], ["/tools", "Free tools"], ["/partners", "Partners"], ["/faq", "FAQ"]]],
  ["Customer resources", [["/login", "Log in"], ["/help", "Help centre"], [OPEN_API_HREF, "API documentation"], ["/whats-new", "What's new"], ["/move", "Moving to Steward"]]],
  ["Company", [["/about", "About us"], ["/leadership", "Leadership"], ["/security", "Security and trust"], ["/for", "Who it's for"], ["/partners", "Partner with us"], ["/contact", "Contact"]]],
  ["Featured guides", [["/guides/first-year-retention", "The first-year retention plan"], ["/guides/major-donor-visits", "Major donor visits for small shops"], ["/articles/state-of-retention", "The state of donor retention"]]],
];

function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="fcols">
          {FOOTER.map(([h, links]) => <div key={h}><h5>{h}</h5>{links.map(([href, t]) => <A href={href} key={t}>{t}</A>)}</div>)}
        </div>
        <div className="legal">
          <span>{copyrightLine()} · {LEGAL_ENTITY_ADDRESS.city}, {LEGAL_ENTITY_STATE}</span>
          <span><A href="/security">Security</A> / <A href="/legal/terms">Terms</A> / <A href="/legal/privacy">Privacy</A> / <A href="/legal/accessibility">Accessibility</A></span>
        </div>
      </div>
    </footer>
  );
}

function useMarketingDocument() {
  useEffect(() => {
    if (!document.querySelector('link[data-mk-fonts]')) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = FONTS; l.setAttribute("data-mk-fonts", "");
      document.head.appendChild(l);
    }
    const prev = document.body.style.background;
    document.body.style.background = GROUND;
    return () => { document.body.style.background = prev; };
  }, []);
}

// Top of the page on every new route; to the named section when the link
// carries a #hash (e.g. /connections#api).
function useScrollOnRoute() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120 }); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
}

export default function MarketingPage({ route }) {
  useMarketingDocument();
  useScrollOnRoute();
  useHead(route);
  const Page = PAGES[route.page];
  return (
    <div className="mk" data-marketing={route.page}>
      <Header />
      <main id="top"><Page slug={route.slug} /></main>
      <Footer />
    </div>
  );
}

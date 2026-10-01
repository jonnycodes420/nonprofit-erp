// LANDING-2 · the Why Steward menu and the Company pages: the case for
// retention, moving, who it's for, security, about, leadership, partners,
// contact, and Book a demo.
import { useState } from "react";
import { Hero, Crumbs, Block, Ui, Cards, FaqS, Incl, Steps, FinalCta, Related, StatBand, QuoteBand, People, Portrait, Pill, Photo, Tick, Icon, A } from "../lib";
import { AUD, AUDIENCE_SLUGS } from "../data/audiences";
import { SRC } from "../data/research";
// Contact keeps the founder's real portrait: never a stock photograph of a person.
import { TEAM } from "../data/team";
import { API } from "../../api";
import { LEGAL_ENTITY_NAME, LEGAL_ENTITY_ADDRESS, LEGAL_ENTITY_STATE } from "../../../../shared/legalEntity.js";

const PLACE = LEGAL_ENTITY_ADDRESS.city + ", " + LEGAL_ENTITY_STATE;

export function Why() {
  return <>
    <Hero eyebrow="Why Steward" crumbs={[["Why Steward"]]} h="The money is in <b>the donors you keep.</b>"
      lede="Fewer people give each year, and most first-time donors never give twice. Steward exists to close that gap for organizations that cannot hire a data team to do it."
      photo="open-house-hug" />
    <StatBand />
    <QuoteBand />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="brass-tint" h="What the numbers mean for a small shop." p="If you had 1,000 donors last year, the national pattern says fewer than half come back without a plan. The second gift is the turning point, and a thank-you call within two days moves the next one. That is exactly the work Steward puts on your Home screen each morning." photo="call-notepad" />
    </div></section>
    <Cards eb="Keep going" h="Why teams <b>choose Steward.</b>" list={[["/move", "Moving to Steward", "About a day of your time, matched to the cent.", "import"], ["/pricing", "Honest pricing", "Published prices, month to month, no platform fee.", "finance"], ["/security", "Security and trust", "What we protect, and how.", "audit"], ["/for", "Who it's for", "Built for the organizations doing the work.", "people"]]} />
    <FinalCta />
  </>;
}

export function Move() {
  return <>
    <Hero eyebrow="Moving to Steward" crumbs={[["Why Steward"], ["Moving to Steward"]]} h="Move in <b>about a day.</b>"
      lede="Tell us where your donors live today, drop in the export, and check the Move Report. Every total matches to the cent against what came out, and you can undo the whole move for 30 days."
      photo="desk-notes" proof={["Matched to the cent", "Undo for 30 days", "Run both side by side"]} />
    <Steps eb="How the move works" h="Three steps, <b>one afternoon.</b>" list={[["Tell us where you are", "Choose your current system or a spreadsheet. Steward knows the export format for common donor systems and maps the fields for you."], ["Drop in the export", "Donors, households, gifts, recurring plans and notes come across together. Possible duplicates are set aside for you to review."], ["Check the Move Report", "Every count and every dollar from your file, side by side with what landed in Steward. If anything is off you see it before you rely on it."]]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="emerald-tint" h="The Move Report." p="Counts and totals from your file beside what Steward holds. Matched lines in green. Anything that needs a decision is listed with the rows behind it."
        sh="Keep your old system running." sp="Run both until you are sure. Re-import a newer file later and only the new gifts come in."
        ui={<Ui t="Move Report" k="check" tots={[["Donors and households", "from file", "4,812"], ["Gifts, all years", "from file", "38,206"], ["Total given", "$6,914,250.18", "$6,914,250.18", 1], ["Duplicates to review", "suggested", "46"]]} />} />
    </div></section>
    <Cards eb="Where are your donors today?" h="Pick your <b>starting point.</b>" list={[["/move/spreadsheet", "Moving from a spreadsheet", "Columns mapped once, households found, totals checked.", "forms"], ["/move/crm", "Moving from another donor system", "Use the export your system already makes. We know the shape.", "import"], ["/onboarding", "Onboarding and support", "A named person for the move and the first month.", "check"]]} />
    <FaqS items={[["What do we need to export?", "Donors, gifts and any recurring plans. We will tell you exactly which reports to run in your current system."], ["What if the totals do not match?", "The Move Report shows you which rows differ before you rely on anything, and we fix it with you."], ["Can we undo it?", "Yes. The whole move can be undone for 30 days."]]} />
    <FinalCta />
  </>;
}

export function MoveSpreadsheet() {
  return <>
    <Hero eyebrow="Moving from a spreadsheet" crumbs={[["Moving to Steward", "/move"], ["From a spreadsheet"]]} h="From a spreadsheet <b>to a real record.</b>"
      lede="Most small shops start in Excel or Google Sheets. Steward reads your columns, finds households and duplicates, and shows you the totals before anything is final." photo="high-five-laptop" />
    <Steps eb="What happens" h="From rows <b>to relationships.</b>" list={[["Map your columns once", "Name, address, gift date, amount, fund. Steward suggests the match and remembers it."], ["Households and duplicates", "Two rows for the same couple become one household. Possible duplicates wait for you."], ["Totals checked", "Your sheet's total and Steward's total, side by side."]]} />
    <FinalCta />
  </>;
}

export function MoveCrm() {
  return <>
    <Hero eyebrow="Moving from another donor system" crumbs={[["Moving to Steward", "/move"], ["From another system"]]} h="Bring everything. <b>Lose nothing.</b>"
      lede="Steward knows the export format for common donor systems. Run the reports we name, drop in the files, and the Move Report checks every gift and every dollar." photo="leaning-back" />
    <Incl h="What comes <b>across.</b>" list={["Donors and households", "Every gift, all years", "Recurring plans", "Soft credits", "Funds and campaigns", "Notes and tasks", "Tags and lists", "Relationship owners"]} />
    <FinalCta />
  </>;
}

export function For() {
  return <>
    <Hero eyebrow="Who it's for" crumbs={[["Who it's for"]]} h="Built for the organizations <b>doing the work.</b>"
      lede="Steward is made for nonprofits with a development team of one to five, a few hundred to ten thousand active donors and no time to babysit software." photo="steps-group" />
    <Cards list={AUDIENCE_SLUGS.map(k => ["/for/" + k, AUD[k].n, AUD[k].l.split(".")[0] + ".", "people"])} />
    <FinalCta />
  </>;
}

export function Audience({ slug }) {
  const a = AUD[slug];
  return <>
    <Hero eyebrow={a.eb} crumbs={[["Who it's for", "/for"], [a.n]]} h={a.h} lede={a.l} photo={a.p} />
    <StatBand n={3} />
    <Incl h="Built for <b>how you work.</b>" list={a.pts} eb={"For " + a.n.toLowerCase()} />
    <Related slugs={["drift", "events", "journeys"]} />
    <FinalCta />
  </>;
}

const SECURE = [["Encrypted in transit", "Every connection to Steward uses HTTPS."], ["Connections sealed", "Keys and tokens for your other tools are encrypted per organization and never shown back in the browser."], ["An audit log for everything", "Every change, export, download and sign-in, with the before and after. Append only."], ["Your data is yours", "Export everything in a standard format whenever you like. Leave and we delete it on request."], ["Scoped access", "Volunteer coordinators and staff see what their role needs."], ["Two-factor sign-in", "A code from an authenticator app or by email, with recovery codes. An owner can require it for the whole team."], ["Sessions you control", "See every browser signed in to your account and sign any of them out. Changing your password signs out the rest."], ["Established infrastructure", "Steward runs on Postgres managed by Supabase, with the app on Railway and Vercel."]];

export function Security() {
  return <>
    <Hero eyebrow="Security and trust" crumbs={[["Why Steward"], ["Security and trust"]]} h="Built like it's holding <b>someone else's money.</b>"
      lede="Because it is. This page lists what Steward does today to protect your donors' information, and what is coming next. Nothing here is aspirational unless it says so." />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="cards">
      {SECURE.map(c => <div className="card" key={c[0]}><span className="ci"><Icon k="audit" size={26} /></span><h4>{c[0]}</h4><p>{c[1]}</p></div>)}
    </div></div></section>
    <Incl eb="On the roadmap" h="Coming <b>next.</b>" list={["Public status page", "Data processing agreement", "Independent security review"]} />
    <FaqS items={[["Where is our data stored?", "In a Postgres database managed by Supabase. Backups are handled by the provider."], ["Do you sell or share donor data?", "No. Never."], ["Can we get our data out?", "Yes, any time, in a standard format."]]} />
    <FinalCta />
  </>;
}

export function About() {
  return <>
    <Crumbs list={[["Company"], ["About"]]} />
    <section className="hero phero"><div className="wrap hero-g solo">
      <div>
        <div className="eyebrow">About Steward</div>
        <h1 className="mix h-xl">Small shops deserve <b>great software.</b></h1>
        <p className="lede">Most nonprofits are run by a handful of people doing the work of twenty. Steward exists so the few people raising the money can spend their time on donors, not on software.</p>
        <div className="ctas"><Pill href="/demo">Book a demo</Pill><Pill kind="soft" href="/signup">Start free</Pill></div>
      </div>
    </div></section>

    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="mission">
      <span className="eyebrow">Our mission</span>
      <p>Help every nonprofit keep the donors it already has, and raise more from the people who already believe in it.</p>
    </div></div></section>

    <section><div className="wrap about-g">
      <div><div className="eyebrow">Why we exist</div><h2 className="mix h-l" style={{ marginTop: 22 }}>Donors don't leave in anger. <b>They drift.</b></h2></div>
      <div className="prose">
        <p>Across the sector, fewer than half of last year's donors give again, and most first-time donors never make a second gift. Almost none of them decided to leave. A card expired. A thank-you came late. A visit kept getting pushed to next month.</p>
        <p>Large organizations hire data teams to catch that drift. Small ones find out at year end, when the moment has passed. Steward puts the handful of people worth a call on the Home screen every morning, with the reason in plain words and a person named on the next step.</p>
        <p className="srcnote">Retention figures: <A href={SRC.fep25[1]}>{SRC.fep25[0]}</A> · <A href={SRC.fep24[1]}>{SRC.fep24[0]}</A></p>
      </div>
    </div></section>

    <section className="pricing"><div className="wrap">
      <div className="eyebrow">What we believe</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>Six things <b>we won't compromise on.</b></h2>
      <div className="beliefs">
        {[["Calm over clever", "One clear next step beats a dashboard of forty charts. If a screen doesn't help someone decide what to do, it doesn't ship."],
          ["Every number opens", "A total you can't trace is a total nobody trusts. Click any figure in Steward and see the gifts and people behind it."],
          ["People send, software helps", "The Agent drafts and organizes, then waits. Nothing reaches a donor until a person decides it should."],
          ["Honest by default", "Prices on the website. Month to month. Only claims that are true today, and a plain label on anything that isn't built yet."],
          ["Your data is yours", "Export everything whenever you like, in a standard format. Leave and we delete it on request. No lock-in, ever."],
          ["No cut of your gifts", "Steward never takes a percentage of a donation. Your processor's card fee is the only fee on a gift."]]
          .map((b, i) => <div className="belief" key={b[0]}><span className="bn">{(i < 9 ? "0" : "") + (i + 1)}</span><h4>{b[0]}</h4><p>{b[1]}</p></div>)}
      </div>
    </div></section>

    <section><div className="wrap">
      <div className="eyebrow">Who we build for</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>Teams of one to five, <b>with missions bigger than their budgets.</b></h2>
      <div className="who-g">
        {[["Development directors", "who carry a portfolio, run the gala and write the appeal in the same week."],
          ["Executive directors", "who are also the fundraiser, the bookkeeper's contact and the board's first call."],
          ["Volunteer coordinators", "who need hours for the grant report and a thank-you list by Friday."],
          ["Board members", "who want numbers they can trust and a list of people to call."]]
          .map(w => <div key={w[0]}><b>{w[0]}</b><p>{w[1]}</p></div>)}
      </div>
      <p style={{ marginTop: 30 }}><A href="/for" style={{ fontWeight: 700, color: "var(--emerald)" }}>See who Steward is for →</A></p>
    </div></section>

    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="emerald-tint" h="How we build."
        p="Small releases, every week, each one tested before it reaches you. Every change is recorded in the audit log, and every release is listed on our What's new page. When we get something wrong we say so and fix it."
        sh="Built with the people who use it."
        sp="Every feature starts from a real nonprofit's week: a gala that needed seating, a bookkeeper who needed a clean file, a director who couldn't find the inbox button."
        ui={<Ui t="What's new" k="spark" rows={[["1", "Audit log for everything", "Every change, with the before and after", "Shipped", "c"], ["2", "Grouped sidebar", "Navigation by job, and a Customize option", "Shipped", "c"], ["3", "Connections and watching", "A warning the day a tool goes quiet", "Shipped", "c"]]} />} />
    </div></section>

    <section className="pricing"><div className="wrap">
      <div className="eyebrow">Our promises to customers</div>
      <h2 className="mix h-m" style={{ marginTop: 22 }}>What you can <b>hold us to.</b></h2>
      <div className="incl">
        {["A real person answers your email", "Your move done with you, checked to the cent", "Thirty days free, then month to month",
          "Unlimited users on every plan", "Every feature on every plan", "No platform fee on any gift",
          "Export everything, any time", "Plain warning before any price change", "We never sell or share donor data"]
          .map(x => <span key={x}><Tick />{x}</span>)}
      </div>
    </div></section>

    <section><div className="wrap about-facts">
      {[["Based in", "Wilmore, Kentucky"], ["Built for", "Teams of one to five"], ["Company", "Steward Software LLC"], ["Funded by", "Angel investment"]]
        .map(f => <div key={f[0]}><span>{f[0]}</span><b>{f[1]}</b></div>)}
    </div></section>

    <Cards eb="Keep exploring" h="More about <b>Steward.</b>" list={[
      ["/leadership", "Leadership", "The founder and advisors behind Steward.", "people"],
      ["/security", "Security and trust", "What we protect, and how.", "audit"],
      ["/whats-new", "What's new", "Every improvement we ship.", "spark"],
      ["/partners", "Partner with us", "Bring Steward to the nonprofits you advise.", "hand"],
      ["/contact", "Contact", "Email goes straight to the founder.", "inbox"]]} />
    <FinalCta />
  </>;
}

export function Leadership() {
  return <>
    <Crumbs list={[["Company", "/about"], ["Leadership"]]} />
    <section className="hero phero" style={{ paddingBottom: 30 }}><div className="wrap">
      <div className="eyebrow">Leadership</div>
      <h1 className="mix h-xl">The people <b>behind Steward.</b></h1>
      <p className="lede" style={{ marginTop: 22 }}>A founder who answers his own email, and advisors who have spent their careers in nonprofit development, the arts and philanthropy.</p>
    </div></section>
    <section style={{ paddingTop: 20 }}><People /></section>
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="backed">
      <span className="eyebrow">Backed by</span>
      <h2 className="mix h-m">Funded by <b>angel investment.</b></h2>
      <p>Steward is independent and founder-led, funded by angel investors who back small nonprofits doing big work.</p>
    </div></div></section>
    <Cards eb="Company" h="More about <b>Steward.</b>" list={[["/about", "About Steward", "What we believe and how we build.", "people"], ["/partners", "Partner with us", "Bring Steward to the nonprofits you advise.", "hand"], ["/contact", "Contact", "Email goes straight to the founder.", "inbox"]]} />
    <FinalCta />
  </>;
}

export function Partners() {
  return <>
    <Hero eyebrow="Partners and consultants" crumbs={[["Company"], ["Partners"]]} h="Bring Steward to <b>the nonprofits you advise.</b>"
      lede="Fundraising consultants, coaches and agencies refer and set up Steward for their clients. Partners earn a share of revenue and get a direct line to the founder."
      photo="handshake" />
    <Steps eb="How partnership works" h="Simple and <b>fair.</b>" list={[["Introduce", "Send us a nonprofit that would be better off with Steward."], ["Close together", "We demo with you on the call, or you run it yourself."], ["Earn", "A share of revenue on every organization you bring, paid monthly."]]} />
    <FinalCta />
  </>;
}

export function Contact() {
  return <>
    <Crumbs list={[["Company"], ["Contact"]]} />
    <section className="hero phero"><div className="wrap hero-g">
      <div>
        <div className="eyebrow">Contact</div>
        <h1 className="mix h-xl">Talk to <b>a person.</b></h1>
        <p className="lede">Questions about Steward, a move, pricing or a partnership. Email goes straight to the founder.</p>
        <div className="ctas"><Pill href="mailto:jonathan@stewardapp.dev">Email jonathan@stewardapp.dev</Pill><Pill kind="soft" href="/demo">Book a demo</Pill></div>
        <p style={{ marginTop: 30, color: "var(--grey)" }}>{LEGAL_ENTITY_NAME} · {PLACE}</p>
      </div>
      <Portrait src={TEAM[0][2]} name={TEAM[0][0]} />
    </div></section>
    <FinalCta />
  </>;
}

// BOOK A DEMO. The request is stored as a lead in the same table the Lost &
// Found leads live in (POST /lost-and-found/lead, which super-admin lists),
// tagged ref "book-a-demo" so it reads as its own source there. Exactly the
// three fields that route accepts are sent, by name. Steward never emails the
// prospect: the route notifies Jonathan only, and he follows up himself.
export const DEMO_REF = "book-a-demo";

export function Demo() {
  const [f, setF] = useState({ name: "", email: "", organization: "", band: "Under 1,000", today: "" });
  const [state, setState] = useState("idle");
  const [err, setErr] = useState("");
  const set = k => e => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setState("sending"); setErr("");
    try {
      const body = { name: f.name.trim(), email: f.email.trim(), organization: f.organization.trim(), ref: DEMO_REF };
      const r = await fetch(API + "/lost-and-found/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "That did not go through. Please try again, or email jonathan@stewardapp.dev.");
      setState("sent");
    } catch (x) {
      setState("idle"); setErr(String((x && x.message) || "That did not go through."));
    }
  }

  return <>
    <Crumbs list={[["Book a demo"]]} />
    <section className="hero phero"><div className="wrap hero-g">
      <div>
        <div className="eyebrow">Book a demo</div>
        <h1 className="mix h-xl">Twenty minutes, <b>your own file.</b></h1>
        <p className="lede">Bring a giving export. We will show you your own drifting donors in Steward, answer every question and tell you exactly what a move looks like.</p>
        {state === "sent" ? (
          <div className="form" data-demo-sent><p className="lede">Thank you. Jonathan will email you within one business day to pick a time.</p></div>
        ) : (
          <form className="form" onSubmit={submit} data-demo-form>
            <label>Your name<input required name="name" autoComplete="name" value={f.name} onChange={set("name")} /></label>
            <label>Work email<input type="email" required name="email" autoComplete="email" value={f.email} onChange={set("email")} /></label>
            <label>Organization<input required name="organization" autoComplete="organization" value={f.organization} onChange={set("organization")} /></label>
            <label>Active donors<select value={f.band} onChange={set("band")}><option>Under 1,000</option><option>1,000 to 5,000</option><option>5,000 to 10,000</option><option>Over 10,000</option></select></label>
            <label>Where are your donors today?<input placeholder="A spreadsheet, another donor system, not sure" value={f.today} onChange={set("today")} /></label>
            {err && <p className="form-err" role="alert">{err}</p>}
            <button className="pill pill-ink" type="submit" disabled={state === "sending"}><i></i>{state === "sending" ? "Sending…" : "Request a time"}</button>
          </form>
        )}
      </div>
      <div>
        <Photo k="video-call" cls="tall" eager />
        <div className="incl" style={{ gridTemplateColumns: "1fr", marginTop: 26 }}>
          <span><Tick />See your own drifting donors</span><span><Tick />A clear plan for the move</span><span><Tick />Your exact price</span>
        </div>
      </div>
    </div></section>
    <StatBand n={3} />
  </>;
}


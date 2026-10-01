// LANDING-2 · the Why Steward menu and the Company pages: the case for
// retention, moving, who it's for, security, about, leadership, partners,
// contact, and Book a demo.
import { useState } from "react";
import { Hero, Crumbs, Block, Ui, Cards, FaqS, Incl, Steps, FinalCta, Related, StatBand, QuoteBand, TeamReel, Pill, Photo, Portrait, Tick, Icon } from "../lib";
import { AUD, AUDIENCE_SLUGS } from "../data/audiences";
import { TEAM } from "../data/team";
import { API } from "../../api";
import { LEGAL_ENTITY_NAME, LEGAL_ENTITY_ADDRESS, LEGAL_ENTITY_STATE } from "../../../../shared/legalEntity.js";

const PLACE = LEGAL_ENTITY_ADDRESS.city + ", " + LEGAL_ENTITY_STATE;

export function Why() {
  return <>
    <Hero eyebrow="Why Steward" crumbs={[["Why Steward"]]} h="The money is in <b>the donors you keep.</b>"
      lede="Fewer people give each year, and most first-time donors never give twice. Steward exists to close that gap for organizations that cannot hire a data team to do it."
      photo="open-house-hug" cta2={["Run the free audit", "/tools/lost-and-found"]} />
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
      photo="desk-notes" cta2={["See onboarding", "/onboarding"]} proof={["Matched to the cent", "Undo for 30 days", "Run both side by side"]} />
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

const SECURE = [["Encrypted in transit", "Every connection to Steward uses HTTPS."], ["Connections sealed", "Keys and tokens for your other tools are encrypted per organization and never shown back in the browser."], ["An audit log for everything", "Every change, export, download and sign-in, with the before and after. Append only."], ["Your data is yours", "Export everything in a standard format whenever you like. Leave and we delete it on request."], ["Scoped access", "Volunteer coordinators and staff see what their role needs."], ["Established infrastructure", "Steward runs on Postgres managed by Supabase, with the app on Railway and Vercel."]];

export function Security() {
  return <>
    <Hero eyebrow="Security and trust" crumbs={[["Why Steward"], ["Security and trust"]]} h="Built like it's holding <b>someone else's money.</b>"
      lede="Because it is. This page lists what Steward does today to protect your donors' information, and what is coming next. Nothing here is aspirational unless it says so."
      cta2={["See the audit log", "/features/audit"]} />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="cards">
      {SECURE.map(c => <div className="card" key={c[0]}><span className="ci"><Icon k="audit" size={26} /></span><h4>{c[0]}</h4><p>{c[1]}</p></div>)}
    </div></div></section>
    <Incl eb="On the roadmap" h="Coming <b>next.</b>" list={["Two-factor sign-in", "Require two-factor for your whole team", "Session list with sign out everywhere", "Public status page", "Data processing agreement", "Independent security review"]} />
    <FaqS items={[["Where is our data stored?", "In a Postgres database managed by Supabase. Backups are handled by the provider."], ["Do you sell or share donor data?", "No. Never."], ["Can we get our data out?", "Yes, any time, in a standard format."]]} />
    <FinalCta />
  </>;
}

export function About() {
  return <>
    <Hero eyebrow="About Steward" crumbs={[["Company"], ["About"]]} h="Small shops deserve <b>great software.</b>"
      lede={`${LEGAL_ENTITY_NAME} is based in ${PLACE}. We build donor software for the organizations that do most of the work and get the least help: teams of one to five people with a mission bigger than their budget.`}
      cta2={["Contact us", "/contact"]} />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="cards">
      {[["Calm over clever", "One clear next step beats a dashboard of forty charts."], ["Honest by default", "Published prices, month to month, and only claims that are true today."], ["People send, software helps", "The Agent drafts. Your staff decide and send."], ["Your data is yours", "Export any time. No lock-in."]].map(c => <div className="card" key={c[0]}><h4>{c[0]}</h4><p>{c[1]}</p></div>)}
    </div></div></section>
    <TeamReel />
    <FinalCta />
  </>;
}

export function Leadership() {
  return <>
    <Crumbs list={[["Company", "/about"], ["Leadership"]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap">
      <div className="eyebrow">Leadership</div>
      <h1 className="mix h-xl">The people <b>behind Steward.</b></h1>
      <p className="lede" style={{ marginTop: 22 }}>A founder who answers his own email, and advisors who have spent their careers in nonprofit development and giving.</p>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap lead-g">
      {TEAM.map(t => <div className="ld" key={t[0]}><Portrait src={t[2]} name={t[0]} /><b>{t[0]}</b><span>{t[1]}</span></div>)}
    </div></section>
    <Cards eb="Company" h="More about <b>Steward.</b>" list={[["/about", "About Steward", "What we believe and how we build.", "people"], ["/partners", "Partner with us", "Bring Steward to the nonprofits you advise.", "hand"], ["/contact", "Contact", "Email goes straight to the founder.", "inbox"]]} />
    <FinalCta />
  </>;
}

export function Partners() {
  return <>
    <Hero eyebrow="Partners and consultants" crumbs={[["Company"], ["Partners"]]} h="Bring Steward to <b>the nonprofits you advise.</b>"
      lede="Fundraising consultants, coaches and agencies refer and set up Steward for their clients. Partners earn a share of revenue and get a direct line to the founder."
      photo="handshake" cta2={["Talk to us", "/contact"]} />
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


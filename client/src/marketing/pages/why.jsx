// LANDING-2 · the Why Steward menu and the Company pages: the case for
// retention, moving, who it's for, security, about, leadership, partners,
// contact, and Book a call.
import { useState } from "react";
import { Hero, Crumbs, Block, Ui, Cards, FaqS, Incl, Steps, FinalCta, Related, StatBand, QuoteBand, People, Portrait, Pill, Photo, Tick, Icon, A, Prose } from "../lib";
import { AUD, AUDIENCE_SLUGS } from "../data/audiences";
import { SRC, SRC_ALL } from "../data/research";
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
    <PeopleLeave />
    <Cards eb="Keep going" h="Why teams <b>choose Steward.</b>" list={[["/move", "Moving to Steward", "About a day of your time, matched to the cent.", "import"], ["/pricing", "Honest pricing", "Published prices, month to month, no platform fee.", "finance"], ["/security", "Security and trust", "What we protect, and how.", "audit"], ["/for", "Who it's for", "Built for the organizations doing the work.", "people"]]} />
    <FinalCta />
  </>;
}

// PROOF-2 · staff turnover, and what Steward keeps when someone leaves. The
// figures are Sage's, worded as the report words them. HANDOVER-1 has not
// shipped, so nothing here promises a handover screen.
function PeopleLeave() {
  const src = SRC_ALL.sage25;
  return (
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">When people leave</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>When people leave, <b>relationships stay.</b></h2>
      <p className="lede" style={{ marginTop: 22 }}>In Sage's 2025 survey of more than 350 nonprofit leaders, 58% said hiring and retention is their biggest external challenge, ahead of competition for funding (55%) and economic uncertainty (49%). When a development officer leaves, what they knew about each donor usually leaves with them. In Steward it stays on the donor's profile.</p>
      <div className="stays">
        {[["Every conversation", "Emails with a donor land on their profile from a connected Gmail or Outlook inbox, replies included, so the thread is not locked in one person's mailbox."],
          ["Every meeting and call", "Meetings, visits and calls are logged on the donor's timeline with the notes from each, and meetings on a connected calendar show there too."],
          ["Every next step", "Tasks and planned steps sit on the donor with a named owner, so the next person can see what was promised and when."],
          ["History", "The History tab shows every change to the donor's details, who made it and when."],
          ["Journeys", "A first-year plan lives on the donor, not in someone's calendar. Each step names a person, and the plan is still there for whoever picks it up."]]
          .map(([h, p]) => <div className="card" key={h}><h4>{h}</h4><p>{p}</p></div>)}
      </div>
      <p className="srcnote">Source: <A href={src[1]}>{src[0]}</A>, a survey of more than 350 nonprofit leaders. Figures are as respondents reported them.</p>
    </div></section>
  );
}

export function Move() {
  return <>
    <Hero eyebrow="Moving to Steward" crumbs={[["Why Steward"], ["Moving to Steward"]]} h="Move in <b>about a day.</b>"
      lede="Tell us where your donors live today, drop in the export, and check the Move Report. Every count and every dollar is checked against what came out, to the cent, and your old system keeps running until you say you have moved."
      photo="desk-notes" proof={["Checked to the cent", "Run both side by side", "Nothing is sent to a donor"]} />
    <Steps eb="How the move works" h="Three steps, <b>one afternoon.</b>" list={[["Tell us where you are", "Choose your current system or a spreadsheet. Steward knows the export format for common donor systems and maps the fields for you."], ["Drop in the export", "Donors, households, gifts, recurring plans and notes come across together. Possible duplicates are flagged for you to review."], ["Check the Move Report", "Every count and every dollar from your file, side by side with what landed in Steward. If anything is off you see it before you rely on it."]]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="emerald-tint" h="The Move Report." p="Counts and totals from your file beside what Steward holds. Matched lines in green. Anything that needs a decision is listed with the rows behind it."
        sh="Keep your old system running." sp="Run both until you are sure. Re-import a newer export later and only the new gifts come in, matched on each gift's ID from your old system."
        ui={<Ui t="Move Report" k="check" tots={[["Donors and households", "from file", "4,812"], ["Gifts, all years", "from file", "38,206"], ["Total given", "$6,914,250.18", "$6,914,250.18", 1], ["Duplicates to review", "suggested", "46"]]} />} />
    </div></section>
    <Cards eb="Where are your donors today?" h="Pick your <b>starting point.</b>" list={[["/move/spreadsheet", "Moving from a spreadsheet", "The columns to bring, a starter template, and how households and gifts map.", "forms"], ["/move/crm", "Moving from your old donor system", "Two exports, joined by the donor ID, checked to the cent.", "import"], ["/move/giving-platform", "Starting from your giving platform", "Connect Stripe, PayPal, Givebutter or Square and read your past gifts in.", "link"]]} />
    <FaqS items={[["What do we need to export?", "Donors, gifts and any recurring plans. For common donor systems, Steward has a short how-to that names the reports to run."], ["What if the totals do not match?", "The Move Report shows you which rows differ before you rely on anything, and we fix it with you."], ["Can we undo it?", "Each time the import joins two rows into one person, that join has its own Undo. When you are sure, an admin presses \"We've moved\" in Settings. It deletes nothing, and it can be undone for 30 days."]]} />
    <FinalCta />
  </>;
}

export function MoveSpreadsheet() {
  return <>
    <Hero eyebrow="Moving from a spreadsheet" crumbs={[["Moving to Steward", "/move"], ["From a spreadsheet"]]} h="Moving from a spreadsheet, <b>column by column.</b>"
      lede="Most small shops start in Excel or Google Sheets. Save your sheet as a CSV or Excel file, and Steward reads your columns, asks about the ones it is not sure of, and checks the totals against your sheet before you rely on them." photo="high-five-laptop" />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="callout">
        <b>Start from our template.</b>
        <p>One row per gift, with every column below already named the way Steward reads it. Open it in Excel or Google Sheets, put your list under the headings, and save it as a CSV.</p>
        <a className="pill pill-ink" href="/marketing/steward-starter-template.csv" download><i></i>Download the CSV template</a>
      </div>
    </div></section>
    <Incl eb="What to bring" h="The columns <b>worth bringing.</b>" list={["First name", "Last name", "Organization", "Email", "Phone", "Address lines", "City", "State", "Postal code", "Gift date", "Gift amount", "Fund or designation", "Payment method", "Campaign or appeal", "Notes", "Household or spouse name"]} />
    <Prose>
      <p>A row needs a name, an email or an organization. Everything else helps, and nothing is required beyond that. Steward suggests a match for each column. Any column it does not recognize, like a second address line or a spouse name, you choose to keep on the profile or leave out, and the import waits until each one is decided. Nothing is dropped quietly.</p>
      <p>Before you save, make sure the first row is your column headings, not a title, and delete any subtotal rows at the bottom. Steward totals the file itself.</p>
      <h2>How households map</h2>
      <p>Two people at one address stay two people in Steward, each with their own giving history. When the file puts the same email behind more than one person, the result screen lists them as household candidates for you to join. Once you join two people into a household, each profile shows the household and its combined giving.</p>
      <h2>How gifts map</h2>
      <p><b>One row per gift.</b> This is the best shape, and it is the shape of the template. The same person appears on as many rows as they made gifts. Steward creates each person once and attaches every row as its own dated gift, so the full history is there from the first morning.</p>
      <p><b>One row per donor, with a column for each year.</b> A sheet with columns like 2023, 2024 and 2025 works too. Each year column becomes one gift for that year, on a date you confirm, and a blank year is skipped. If you can get a list of individual gifts instead, bring that, because the dates of single gifts are what Steward reads to notice who is slipping.</p>
      <p>Each gift lands in a fund. A fund name that matches one you already have is used, and a new name becomes a new unrestricted fund. The payment method is kept on its own.</p>
      <h2>Duplicates, set aside to review</h2>
      <p>When a row matches someone already in Steward, or two rows in the file are plainly the same person, they become one person, and each join is listed on the result screen with its own Undo. Two gifts from the same person on the same day for the same amount are flagged for you to review rather than guessed at. A row with no name, no email and no organization is set aside by line number with the reason.</p>
    </Prose>
    <Steps eb="How the move works" h="Three steps, <b>one afternoon.</b>" list={[["Tell us where you are", "Choose your current system or a spreadsheet. Steward knows the export format for common donor systems and maps the fields for you."], ["Drop in the export", "Donors, households, gifts, recurring plans and notes come across together. Possible duplicates are flagged for you to review."], ["Check the Move Report", "Every count and every dollar from your file, side by side with what landed in Steward. If anything is off you see it before you rely on it."]]} />
    <FaqS items={[["Which files can Steward read?", "CSV, TSV and Excel files (.xlsx and .xls). You can also paste CSV text straight in."], ["Our donors and gifts are on two sheets. Is that a problem?", "No. If one workbook has a donors sheet and a gifts sheet, Steward offers to import both at once and links each gift to its donor."], ["Do we have to use the template?", "No. It is a shortcut. Steward reads your own headings and asks about any it is not sure of, once."], ["Will donors hear anything when we import?", "No. An import is history. It sends nothing to anyone and starts nothing on its own."]]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="callout">
        <b>Bring your sheet to a call.</b>
        <p>In 20 minutes we will show you your own donors in Steward. Or run the free Lost & Found audit on your giving export first. It runs in your browser and nothing is uploaded.</p>
        <div className="ctas" style={{ marginTop: 6 }}><Pill href="/demo">Book a call</Pill><Pill kind="soft" href="/tools/lost-and-found">Run Lost & Found</Pill></div>
      </div>
    </div></section>
    <FinalCta />
  </>;
}

export function MoveCrm() {
  return <>
    <Hero eyebrow="Moving from your old donor system" crumbs={[["Moving to Steward", "/move"], ["From your old donor system"]]} h="Moving from your old <b>donor system.</b>"
      lede="Almost every donor system can export two files: your contacts and your gifts. Bring both, and the Move Report checks every count and every dollar against them before you rely on anything." photo="leaning-back" />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">The two exports</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>Two files, <b>joined by one column.</b></h2>
      <div className="cards" style={{ marginTop: 36 }}>
        <div className="card"><span className="ci"><Icon k="people" size={26} /></span><h4>Contacts</h4><p>Every person and organization, with the ID your old system gave each one. Add names, email, phone, address, and flags like do not mail or deceased.</p></div>
        <div className="card"><span className="ci"><Icon k="finance" size={26} /></span><h4>Gifts</h4><p>One row per gift, with the donor ID, the date, the amount and the fund. Add the gift ID, appeal and payment method if your system has them, and the donor name or email too.</p></div>
        <div className="card"><span className="ci"><Icon k="link" size={26} /></span><h4>Why the ID matters</h4><p>Each gift row carries its donor ID, so Steward links it to the right person even when two people share a name. On a later import the ID is matched first, then email, then name, so a corrected address does not create a second person.</p></div>
      </div>
      <p style={{ marginTop: 30 }}>If your system puts both on two sheets of one workbook, Steward offers to import both at once. For common donor systems, Steward has a short how-to that names the reports to run.</p>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="emerald-tint" h="Checked to the cent." p="The Move Report puts the counts and dollar totals from your file beside what landed in Steward: people, households, gifts, the total, and each year's dollars. A line that is off says by how much, and the rows behind it are listed. You can also type in your old system's own totals and see them in a column of their own."
        sh="Run both side by side." sp="Keep your old system running while you check. Export again later and import the newer file: gifts whose ID is already in Steward are skipped, and you see what is new since last time."
        ui={<Ui t="Move Report" k="check" tots={[["People", "from file", "2,140"], ["Gifts, all years", "from file", "17,385"], ["Total given", "$2,406,118.40", "$2,406,118.40", 1], ["2025", "$318,902.15", "$318,902.15", 1]]} />} />
    </div></section>
    <Incl eb="What comes across" h="Your history, <b>not just your list.</b>" list={["People and organizations", "Every gift, all years", "Funds and appeals", "Soft credits", "Pledges, as commitments", "Monthly donors", "Relationship owners", "Do not mail, do not email and deceased"]} />
    <Prose>
      <h2>When you are sure</h2>
      <p>Nothing reaches a donor during the move. An import sends nothing and starts nothing on its own. When the Move Report matches and you trust it, an admin presses &quot;We&apos;ve moved&quot; in Settings. It deletes nothing, it can be undone for 30 days, and every Move Report stays on file in Settings, under Imports.</p>
    </Prose>
    <Steps eb="How the move works" h="Three steps, <b>one afternoon.</b>" list={[["Tell us where you are", "Choose your current system or a spreadsheet. Steward knows the export format for common donor systems and maps the fields for you."], ["Drop in the export", "Donors, households, gifts, recurring plans and notes come across together. Possible duplicates are flagged for you to review."], ["Check the Move Report", "Every count and every dollar from your file, side by side with what landed in Steward. If anything is off you see it before you rely on it."]]} />
    <FaqS items={[["Our system is not one you have a how-to for. Can we still move?", "Yes. The contacts and gifts exports work from almost any system. The mapper shows every column and asks which is which, once, before anything is written."], ["What if the totals do not match?", "The Move Report says by how much, and lists the rows behind the difference. A row that was set aside is listed by line number with the reason, so nothing goes missing quietly."], ["Can we keep using our old system for a while?", "Yes. Run both, and import a newer export whenever you like. Gifts already in Steward are skipped by their ID, and you see only what is new."], ["Can we undo it?", "Each time the import joins two rows into one person, that join has its own Undo. \"We've moved\" can be undone for 30 days and deletes nothing."]]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="callout">
        <b>Bring your export to a call.</b>
        <p>In 20 minutes we will show you your own donors in Steward and what your move looks like. Or run the free Lost & Found audit on a giving export first. It runs in your browser and nothing is uploaded.</p>
        <div className="ctas" style={{ marginTop: 6 }}><Pill href="/demo">Book a call</Pill><Pill kind="soft" href="/tools/lost-and-found">Run Lost & Found</Pill></div>
      </div>
    </div></section>
    <FinalCta />
  </>;
}

// The four giving tools Steward reads today, each as shared/givingSources.js
// and the help centre describe it. Every connection is read-only and uses the
// organization's own credentials, entered in Settings, under Connections.
export function MoveGivingPlatform() {
  return <>
    <Hero eyebrow="Starting from your giving platform" crumbs={[["Moving to Steward", "/move"], ["From your giving platform"]]} h="Starting from your <b>giving platform.</b>"
      lede="If your donor list lives in the tool that takes your gifts, start there. Connect it in Settings with your organization's own key, and Steward reads your past gifts in and keeps reading new ones. It never moves a dollar." photo="desk-notes" />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">What Steward reads today</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>Four tools, <b>read only.</b></h2>
      <div className="cards" style={{ marginTop: 36 }}>
        <div className="card"><span className="ci"><Icon k="finance" size={26} /></span><h4>Stripe</h4><p>Create a restricted key in Stripe with read access to Charges, Subscriptions, Invoices and Customers, and paste it into the Stripe card. The first read brings in your past charges, and monthly gifts come across as monthly because Stripe names the subscription. Taking card gifts on Steward giving pages is a separate Stripe connection, for new gifts only.</p></div>
        <div className="card"><span className="ci"><Icon k="finance" size={26} /></span><h4>PayPal</h4><p>Create an app in PayPal with Transaction Search switched on, and paste its Client ID and Secret into the PayPal card. PayPal can take up to a day to allow this, and Steward keeps trying. The first read reaches back as far as PayPal allows, about three years. For older gifts, download your PayPal activity as a CSV and import it. A payment that arrives both ways lands once.</p></div>
        <div className="card"><span className="ci"><Icon k="finance" size={26} /></span><h4>Givebutter</h4><p>Create an API key in Givebutter and paste it into the Givebutter card. The first read brings in your past transactions, with monthly plans named as monthly. Or drop in Givebutter&apos;s own export as a file: Steward knows its columns.</p></div>
        <div className="card"><span className="ci"><Icon k="finance" size={26} /></span><h4>Square</h4><p>Copy your production access token from Square&apos;s developer dashboard into the Square card, then choose which locations take donations. Square cannot tell a donation from a lesson fee, so Steward brings in nothing until you choose. For gifts older than the first read brings, export them from Square as a CSV and import the file.</p></div>
      </div>
    </div></section>
    <Prose>
      <h2>How a giving tool becomes a donor list</h2>
      <p>Each payment comes in as a gift on the donor&apos;s profile. A payment whose email matches someone already in Steward attaches to that person. Anyone else becomes a new person, and a name that only looks like someone on file is never merged on a guess: it lands as its own person and is reported to you.</p>
      <p>The first read is history. It drafts no thank-yous and starts nothing on its own. After that, Steward checks every six hours, and a new gift gets a thank-you drafted for a person on your team to read and send. Transfers to your bank, payouts and fees are not gifts and are left out.</p>
      <p>Steward reads these tools and never writes to them. It cannot refund, charge or change anything in your account, and the keys are encrypted for your organization and never shown back in the browser.</p>
      <h2>Using another tool too?</h2>
      <p>Export your donors and past gifts as a CSV and import the file. See <A href="/move/spreadsheet">moving from a spreadsheet</A> for the columns to bring.</p>
    </Prose>
    <Steps eb="How the move works" h="Three steps, <b>one afternoon.</b>" list={[["Tell us where you are", "Choose your current system or a spreadsheet. Steward knows the export format for common donor systems and maps the fields for you."], ["Drop in the export", "Donors, households, gifts, recurring plans and notes come across together. Possible duplicates are flagged for you to review."], ["Check the Move Report", "Every count and every dollar from your file, side by side with what landed in Steward. If anything is off you see it before you rely on it."]]} />
    <FaqS items={[["Do we have to stop using our giving tool?", "No. Keep taking gifts the way you do today. Steward reads the tool on a schedule, and every gift still goes straight to your organization."], ["Where do we connect it?", "In Settings, under Connections. Stripe, PayPal and Givebutter are under Giving, and Square is under Point of sale. Each card says when it last checked and whether anything needs attention."], ["Will a gift be counted twice if we also import a file?", "A gift is matched on the tool's own payment ID, so a PayPal statement and the PayPal connection carrying the same payment land as one gift."], ["Will Steward email our donors?", "No. Steward drafts thank-yous for new gifts, and a person on your team reads each one and sends it from their own email."]]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="callout">
        <b>See your own donors in Steward.</b>
        <p>Bring a giving export to a 20-minute call. Or run the free Lost & Found audit on it first. It runs in your browser and nothing is uploaded.</p>
        <div className="ctas" style={{ marginTop: 6 }}><Pill href="/demo">Book a call</Pill><Pill kind="soft" href="/tools/lost-and-found">Run Lost & Found</Pill></div>
      </div>
    </div></section>
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

const SECURE = [["Encrypted in transit", "Every connection to Steward uses HTTPS."], ["Connections sealed", "Keys and tokens for your other tools are encrypted per organization and never shown back in the browser."], ["An audit log for everything", "Every change, export, download and sign-in, with the before and after. Append only."], ["Your data is yours", "Export everything in a standard format whenever you like. Leave and we delete it on request."], ["Scoped access", "Volunteer coordinators and staff see what their role needs."], ["Two-factor sign-in", "A code from an authenticator app or by email, with recovery codes. An owner can require it for the whole team."], ["Sessions you control", "See every browser signed in to your account and sign any of them out. Changing your password signs out the rest."], ["A public status page", "Every service checked every minute, with 90 days of history at stewardapp.dev/status."], ["Your donors' rights", "Export everything about one person, or erase them and keep their gifts as anonymous gifts. See stewardapp.dev/your-data."], ["Established infrastructure", "Steward runs on Postgres managed by Supabase, with the app on Railway and Vercel."]];

export function Security() {
  return <>
    <Hero eyebrow="Security and trust" crumbs={[["Why Steward"], ["Security and trust"]]} h="Built like it's holding <b>someone else's money.</b>"
      lede="Because it is. This page lists what Steward does today to protect your donors' information, and what is coming next. Nothing here is aspirational unless it says so." />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="cards">
      {SECURE.map(c => <div className="card" key={c[0]}><span className="ci"><Icon k="audit" size={26} /></span><h4>{c[0]}</h4><p>{c[1]}</p></div>)}
    </div></div></section>
    <Incl eb="On the roadmap" h="Coming <b>next.</b>" list={["Data processing agreement", "Independent security review"]} />
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
        <div className="ctas"><Pill href="/demo">Book a call</Pill><Pill kind="soft" href="/signup">Start free</Pill></div>
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
        <div className="ctas"><Pill href="mailto:jonathan@stewardapp.dev">Email jonathan@stewardapp.dev</Pill><Pill kind="soft" href="/demo">Book a call</Pill></div>
        <p style={{ marginTop: 30, color: "var(--grey)" }}>{LEGAL_ENTITY_NAME} · {PLACE}</p>
      </div>
      <Portrait src={TEAM[0][2]} name={TEAM[0][0]} />
    </div></section>
    <FinalCta />
  </>;
}

// BOOK A CALL. The request is stored as a lead in the same table the Lost &
// Found leads live in (POST /lost-and-found/lead, which super-admin lists),
// tagged ref "book-a-demo" so it reads as its own source there. Every field
// on the form is sent, by name: the three the audit's lead also has, plus the
// size band and where the donors are today (FIX-13). Steward never emails the
// prospect: the route notifies Jonathan only, and he follows up himself.
export const DEMO_REF = "book-a-demo";
export const DEMO_FALLBACK = "That did not go through. Please email jonathan@stewardapp.dev and he will set up a time with you.";

export function Demo() {
  const [f, setF] = useState({ name: "", email: "", organization: "", band: "Under 1,000", today: "" });
  const [state, setState] = useState("idle");
  const [err, setErr] = useState("");
  const set = k => e => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setState("sending"); setErr("");
    try {
      const body = { name: f.name.trim(), email: f.email.trim(), organization: f.organization.trim(), orgSize: f.band, currentSystem: f.today.trim(), ref: DEMO_REF };
      const r = await fetch(API + "/lost-and-found/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ? d.message + " If it keeps failing, email jonathan@stewardapp.dev." : DEMO_FALLBACK);
      setState("sent");
    } catch (x) {
      // Never a silent nothing: a network failure (no message worth showing)
      // gets the plain sentence with the address to write to.
      const m = x && x.message;
      setState("idle"); setErr(m && /jonathan@stewardapp\.dev/.test(m) ? m : DEMO_FALLBACK);
    }
  }

  return <>
    <Crumbs list={[["Book a call"]]} />
    <section className="hero phero"><div className="wrap hero-g">
      <div>
        <div className="eyebrow">Book a call</div>
        <h1 className="mix h-xl">Twenty minutes, <b>your own file.</b></h1>
        <p className="lede">Bring a giving export. We will show you your own drifting donors in Steward, answer every question and tell you exactly what a move looks like.</p>
        {state === "sent" ? (
          <div className="form" data-demo-sent><p className="lede">Thank you. Jonathan will email you within one business day to pick a time.</p></div>
        ) : (
          <form className="form" onSubmit={submit} data-demo-form>
            <label htmlFor="demo-name">Your name<input id="demo-name" required name="name" autoComplete="name" value={f.name} onChange={set("name")} /></label>
            <label htmlFor="demo-email">Work email<input id="demo-email" type="email" required name="email" autoComplete="email" value={f.email} onChange={set("email")} /></label>
            <label htmlFor="demo-organization">Organization<input id="demo-organization" required name="organization" autoComplete="organization" value={f.organization} onChange={set("organization")} /></label>
            <label htmlFor="demo-org-size">Active donors<select id="demo-org-size" name="orgSize" autoComplete="off" value={f.band} onChange={set("band")}><option>Under 1,000</option><option>1,000 to 5,000</option><option>5,000 to 10,000</option><option>Over 10,000</option></select></label>
            <label htmlFor="demo-current-system">Where are your donors today?<input id="demo-current-system" name="currentSystem" autoComplete="off" placeholder="A spreadsheet, another donor system, not sure" value={f.today} onChange={set("today")} /></label>
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


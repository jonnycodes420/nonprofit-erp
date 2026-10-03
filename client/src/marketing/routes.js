// LANDING-2 · every marketing route, in ONE table. The router (main.jsx), the
// sitemap (client/public/sitemap.xml, checked against this by
// tests/landing2-marketing.test.js) and the link guards all read it, so a
// page cannot exist in one and be missing from another.
//
// Pure data: no JSX, so Node can import it. `page` names the component in
// pages/index.js. Titles follow the reference: "Steward · " + the page's H1.
//
// COLLISIONS. Existing app routes win, and these are deliberately NOT here:
//   /developers     named in the brief but it does not exist; Open API links
//                   point at /connections#api instead
//   /lost-and-found the free audit itself; /tools/lost-and-found links in
//   /login, /signup the app's own pages
//   /privacy, /terms the live legal pages; /legal/* are the attorney drafts
import { FEAT, FEATURE_SLUGS } from "./data/features.js";
import { AUD, AUDIENCE_SLUGS } from "./data/audiences.js";
import { GUIDES, GUIDE_SLUGS } from "./data/guides.js";
import { ARTICLES } from "./articles/index.js";
import { GLOSSARY, GLOSSARY_UPDATED } from "./data/glossary.js";
import { HELP_ARTICLES } from "../../../shared/helpArticles.js";

// Titles drop the headline markup. The copy uses only <b>, <em> and <br>.
const plain = s => s.replace(/<\/?(?:b|em|br)\s*\/?>/g, "");
const T = h => "Steward · " + plain(h);
// A search snippet: the whole sentence when it fits, else cut at a word.
const clip = (s, n = 158) => s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1)).replace(/[,;:]$/, "") + "…";

export const HOME_TITLE = "Steward · Keep the donors you already have";

export const ROUTES = [
  { path: "/", page: "home", title: HOME_TITLE,
    description: "Steward shows you who is drifting while a phone call still fixes it, then runs the rest of your development office: gifts, events, volunteers, email and month end, in one calm place." },

  { path: "/platform", page: "platform", title: T("One calm place for the whole office."), description: "Donors, gifts, events, volunteers, email and month end, on one record that watches itself. Steward tells you who needs you each morning, and every number opens to the people behind it." },
  { path: "/crm", page: "crm", title: T("Keep more donors, without more staff."), description: "A donor CRM built for a development team of one to five. It shows you who is drifting while a call still fixes it, keeps new donors close through their first year, and gives the board numbers that open to the people behind them." },
  { path: "/volunteer", page: "volunteer", title: T("Count every hour, thank every helper."), description: "Recruit, schedule and thank volunteers on the same record as giving. See which volunteers also give and which donors also serve, and hand your grant reports real hours instead of guesses." },
  { path: "/agent", page: "agent", title: T("Say what you need. Approve the plan."), description: "Tell it what happened and it does the work in Steward: updates records, logs conversations, signs up volunteers, starts journeys. It shows the plan first, checks every step after, never sends to a donor and never records money on its own." },
  { path: "/connections", page: "connections", title: T("Keep your tools. Steward watches them."), description: "Gifts flow in from the giving tools you already use. Steward checks every payout against its gifts and tells you the day a connection goes quiet, before a month of gifts goes missing." },
  { path: "/onboarding", page: "onboarding", title: T("Your move, done with you."), description: "Every new organization gets a real person for the move, the setup and the first month. You will know their name and their email address." },

  { path: "/features", page: "features", title: T("Everything included, nothing to unlock."), description: "Every feature is on every plan. No add-ons, no premium tier and no surprise invoice when you grow." },
  ...FEATURE_SLUGS.map(s => ({ path: "/features/" + s, page: "feature", slug: s, title: T(FEAT[s].h), description: FEAT[s].lede })),

  // LANDING-3 part 1: /pricing moved here from the app router. The page
  // still carries the signed-in Stripe checkout, so the upgrade path from
  // UpgradeModal, goToPricing() and Settings is unchanged.
  { path: "/pricing", page: "pricing", title: T("Pricing that respects your budget."), description: "Every feature on every plan, priced by active donors. Seed $199, Sapling $299, Orchard $499 a month, and a conversation above ten thousand donors. Thirty days free, then month to month." },

  { path: "/why", page: "why", title: T("The money is in the donors you keep."), description: "Fewer people give each year, and most first-time donors never give twice. Steward exists to close that gap for organizations that cannot hire a data team to do it." },
  { path: "/leadership", page: "leadership", title: T("The people behind Steward."), description: "A founder who answers his own email, and advisors who have spent their careers in nonprofit development and giving." },
  { path: "/move", page: "move", title: T("Move in about a day."), description: "Tell us where your donors live today, drop in the export, and check the Move Report. Every total is checked to the cent against what came out, and your old system keeps running until you are sure." },
  { path: "/move/spreadsheet", page: "moveSpreadsheet", title: T("Moving from a spreadsheet, column by column."), description: "Which columns to bring from Excel or Google Sheets, how gifts and households map, and a starter CSV template to download. Steward checks the totals before you rely on them." },
  { path: "/move/crm", page: "moveCrm", title: T("Moving from your old donor system."), description: "Export two files from almost any donor system, contacts and gifts. Steward joins them on the donor ID and the Move Report checks every dollar to the cent." },
  { path: "/move/giving-platform", page: "moveGivingPlatform", title: T("Starting from your giving platform."), description: "If your donor list lives in Stripe, PayPal, Givebutter or Square, connect it with your own account and Steward reads your past gifts in. Anything older comes in from an export." },
  { path: "/for", page: "for", title: T("Built for the organizations doing the work."), description: "Steward is made for nonprofits with a development team of one to five, a few hundred to ten thousand active donors and no time to babysit software." },
  ...AUDIENCE_SLUGS.map(s => ({ path: "/for/" + s, page: "audience", slug: s, title: T(AUD[s].h), description: AUD[s].l })),
  { path: "/security", page: "security", title: T("Built like it's holding someone else's money."), description: "Because it is. This page lists what Steward does today to protect your donors' information, and what is coming next. Nothing here is aspirational unless it says so." },
  // TRUST-2: status, subprocessors, your data, and the DPA (a draft until an attorney has read it).
  { path: "/status", page: "status", title: T("Steward status."), description: "Whether Steward is working right now, checked every minute, with 90 days of history counted from stored checks." },
  { path: "/subprocessors", page: "subprocessors", title: T("Who else touches your data."), description: "Every company that receives your organisation's or your donors' information when you use Steward, what it gets and why." },
  { path: "/your-data", page: "yourData", title: T("Your data, and your donors' data."), description: "How to take everything with you, answer a donor who asks what you hold, and erase a donor who asks to be forgotten." },
  { path: "/dpa", page: "dpa", title: T("Data processing agreement."), description: "The terms under which Steward processes your organisation's data." },
  { path: "/about", page: "about", title: T("Small shops deserve great software."), description: "We build donor software for the organizations that do most of the work and get the least help: teams of one to five people with a mission bigger than their budget." },
  { path: "/partners", page: "partners", title: T("Bring Steward to the nonprofits you advise."), description: "Fundraising consultants, coaches and agencies refer and set up Steward for their clients. Partners earn a share of revenue and get a direct line to the founder." },
  { path: "/contact", page: "contact", title: T("Talk to a person."), description: "Questions about Steward, a move, pricing or a partnership. Email goes straight to the founder." },
  { path: "/demo", page: "demo", title: T("Twenty minutes, your own file."), description: "Bring a giving export. We will show you your own drifting donors in Steward, answer every question and tell you exactly what a move looks like." },

  { path: "/resources", page: "resources", title: T("Learn from people who've done the work."), description: "Guides, templates, free tools and the research behind them, for development teams of one to five." },
  { path: "/guides", page: "guides", title: T("Practical guides for small teams."), description: "Plans you can run this month, written for a development office of one to five people." },
  ...GUIDE_SLUGS.map(s => ({ path: "/guides/" + s, page: "guide", slug: s, title: T(GUIDES[s].t), description: GUIDES[s].d })),
  { path: "/templates", page: "templates", title: T("Templates you can use today."), description: "Thank-you letters, win-back emails and other templates for a small development team. Copy, adapt and send. Every template is free." },
  { path: "/articles", page: "articles", title: T("Ideas worth a coffee break."), description: "Short reads on retention, stewardship and running a calm development office." },
  // CONTENT-1 · one route per markdown file in articles/, dated by its frontmatter.
  ...ARTICLES.map(a => ({ path: "/articles/" + a.slug, page: "article", slug: a.slug, title: T(a.headline), description: a.description, lastmod: a.date, kind: "article" })),
  // PROOF-2 · every source the site quotes, so anyone can verify us.
  { path: "/research", page: "research", title: T("Every number, and where it came from."), description: "Every statistic on the Steward site, with the source's own words, a link to the report and the date we last checked it." },
  { path: "/glossary", page: "glossary", title: T("Fundraising terms, in plain words."), description: "The words you will hear in board meetings and on software demos, explained without jargon." },
  ...GLOSSARY.map(g => ({ path: "/glossary/" + g.slug, page: "glossaryTerm", slug: g.slug, title: "Steward · " + g.term + ": " + (g.calc ? "definition, formula and example" : "what it means and why it matters"), description: clip(g.def), lastmod: GLOSSARY_UPDATED, kind: "term" })),
  { path: "/faq", page: "faq", title: T("Questions? We've got answers."), description: "How long a move takes, what counts as an active donor, whether Steward takes a cut of donations, and who to call for help." },
  { path: "/help", page: "help", title: T("How do I do this in Steward?"), description: "An article for every screen in Steward and for the jobs people come for, searchable. If it is not here, a person answers." },
  ...HELP_ARTICLES.map(a => ({ path: "/help/" + a.slug, page: "helpArticle", slug: a.slug, title: T(a.title), description: a.summary })),
  { path: "/whats-new", page: "whatsNew", title: T("What we shipped lately."), description: "Steward ships improvements every week. Here is the recent list, newest first." },

  { path: "/tools", page: "tools", title: T("Free tools, no signup."), description: "Run them on your own numbers. Nothing you type leaves your browser." },
  { path: "/tools/lost-and-found", page: "toolLostAndFound", title: T("See who you're about to lose."), description: "Drop in a giving export and Lost & Found shows your lapsing donors and what they used to give. It runs entirely in your browser. Nothing is uploaded and nothing is stored." },
  { path: "/tools/retention", page: "toolRetention", title: "Steward · Donor retention rate calculator (Keep Rate)", description: "Work out your donor retention rate from two numbers, see it beside the national figure, and what a five-point lift would be worth. Free, in your browser." },
  { path: "/tools/lapsed-cost", page: "toolLapsed", title: "Steward · Lapsed donor cost calculator (Lapse Ledger)", description: "Put a dollar figure on the donors who quietly stopped: what they used to give each year, and what a round of calls could be worth. Free, in your browser." },
  { path: "/tools/thermometer", page: "toolThermometer", title: "Steward · Fundraising thermometer (Goal Gauge)", description: "A free fundraising thermometer: type your campaign goal and what you have raised so far, and see how full the bar is. Nothing you type leaves your browser." },
  { path: "/tools/lybunt-sybunt", page: "toolLybunt", title: T("Find your LYBUNT and SYBUNT donors."), description: "Drop in a gifts CSV and see who gave last year but not this year, and who gave in an earlier year. Totals foot to your file. Nothing leaves your browser." },
  { path: "/tools/thank-you-letter", page: "toolThankYou", title: "Steward · Donor thank-you letter builder", description: "Pick the gift: a first gift, monthly, major, in memory or year-end. Fill in a few details and copy a warm, specific thank-you letter. Free, no signup." },

  { path: "/legal/privacy", page: "legalPrivacy", title: "Steward · Privacy policy", description: "How Steward handles the information organizations put into it and the information about the people who sign in. Draft for attorney review." },
  { path: "/legal/terms", page: "legalTerms", title: "Steward · Terms of service", description: "The terms for using Steward, the donor management service. Draft for attorney review." },
  { path: "/legal/accessibility", page: "legalAccessibility", title: "Steward · Accessibility", description: "We design Steward to WCAG 2.1 AA, test with keyboards and screen readers, and fix what we find." },
];

// App routes the marketing pages link to. They are real pages, just not
// marketing ones; the link guard accepts them alongside ROUTES.
export const APP_LINK_TARGETS = ["/login", "/signup", "/lost-and-found", "/app/settings"];
// CONTENT-1 · files the pages link to: the articles feed (written by the
// prerender) and the move page's starter template (client/public).
export const FILE_LINK_TARGETS = ["/rss.xml", "/marketing/steward-starter-template.csv"];

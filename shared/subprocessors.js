// shared/subprocessors.js — TRUST-2 Part 3. EVERY THIRD PARTY THAT RECEIVES
// CUSTOMER DATA, built from the code and the deployment's variable names, not
// from memory (see the build report for the call sites and env vars behind
// each row). The public /subprocessors page and the DPA both read this list,
// so the two can never disagree.
//
// Regions are NOT listed: none is stated in the code, and a region on this
// page has to be one we have confirmed with the provider.
//
// `when`: "always" is used for every organisation; "connected" only when an
// organisation connects that service; "configured" only when Steward has
// turned the feature on for the deployment.
//
// Pure data. Change it in the same commit as the code that adds or removes a
// third party.
export const SUBPROCESSORS = [
  { name: "Supabase", what: "Every record in Steward: donors, gifts, notes, users and settings.", why: "The managed Postgres database Steward runs on.", when: "always" },
  { name: "Railway", what: "Everything Steward processes while it runs, application logs, and uploaded files (photos, cheque images, logos, grant documents) in its storage bucket.", why: "Hosts the Steward application and its file storage.", when: "always" },
  { name: "Vercel", what: "Page requests to the Steward website and app, including page addresses, and anonymous page-speed and visit measurements.", why: "Hosts the website and the app's pages.", when: "always" },
  { name: "Resend", what: "Recipient addresses, subjects and the body of every email Steward sends (receipts include the donor's name, the amount and the date), and email sent to your BCC logging address.", why: "Sends and receives email.", when: "always" },
  { name: "Sentry", what: "Error reports from the app, which can include the page and request details at the moment something failed.", why: "Tells us when something breaks so we can fix it.", when: "always" },
  { name: "Stripe", what: "Donor name, email and card for online gifts and monthly plans, and your organisation's billing details.", why: "Takes payments, through your own connected Stripe account, and bills your Steward subscription.", when: "connected" },
  { name: "Anthropic", what: "The text a drafting or reading feature needs: for example a donor's record rows for a brief or a draft, gift numbers, a photo of a cheque, or the transcript of a voice memo with the donor's name.", why: "Drafting, reading cheques and analysis. Nothing is sent once your organisation turns AI off in Settings.", when: "configured" },
  { name: "OpenAI", what: "The audio of a voice memo a staff member records about a donor, and nothing else: no donor name, no organisation name. It sends back the transcript.", why: "Turns a voice memo into text. Nothing is sent once your organisation turns AI off in Settings.", when: "configured" },
  { name: "Google", what: "Messages and calendar events involving people already in your Steward, read from a staff member's own Gmail and Google Calendar, and events they book from a profile.", why: "Logs email and meetings onto the donor record.", when: "connected" },
  { name: "Microsoft", what: "The same as Google, for Outlook and Microsoft 365.", why: "Logs email and meetings onto the donor record.", when: "connected" },
  { name: "Mailchimp, Constant Contact", what: "Donor email addresses and first and last names you choose to sync, and the opens, clicks and unsubscribes they send back.", why: "Keeps your mailing list and your donor record in step.", when: "connected" },
  { name: "QuickBooks Online, Xero", what: "Deposit lines with amounts and funds. Donor names only if you turn that on (it is off by default).", why: "Posts deposits to your books.", when: "connected" },
  { name: "PayPal, Square, Zeffy, Givebutter", what: "Steward reads payer names, emails and amounts from these and sends them nothing but the connection's credentials.", why: "Brings gifts taken elsewhere onto the record.", when: "connected" },
  { name: "Geocodio", what: "Donor street addresses.", why: "Places donors on the map.", when: "configured" },
  { name: "OpenStreetMap", what: "The map tiles your browser asks for when you open the donor map, which reveals the area being viewed.", why: "Draws the donor map.", when: "always" },
  // PROSPECT-1 — no provider is chosen yet. Steward never sends the file:
  // a staff member downloads it and gives it to the provider they chose.
  { name: "Screening provider, to be named", what: "Only the people a staff member puts in a screening file: their names, mailing addresses, emails and spouse names where known. The provider returns capacity and real estate ranges, known gifts to other charities, foundation ties and business affiliations, which Steward stores with the provider's name and the date.", why: "Wealth screening, so major gifts staff can see who has room to give more.", when: "used" },
  { name: "Google Fonts", what: "The visitor's network address when a page loads its typefaces.", why: "Serves the typefaces Steward's pages use.", when: "always" },
];

export const WHEN_WORDS = {
  always: "Used for every organisation",
  connected: "Only if your organisation connects it",
  configured: "Only when the feature is switched on",
  used: "Only when a staff member uses that feature",
};

export default { SUBPROCESSORS, WHEN_WORDS };

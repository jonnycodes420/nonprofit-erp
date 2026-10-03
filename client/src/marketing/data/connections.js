// LANDING-3 · built and deployed means Live. "Set up with you" is gone from
// this table and from every page that read it: a connection either works from
// Settings on a real organisation today, or it is honestly labelled Coming.
//
// EVERY LABEL BELOW WAS CHECKED AGAINST PRODUCTION, because a wrong "Live" is
// a promise the product cannot keep. Stripe, PayPal, Givebutter and Square
// take the organisation's own credentials in Settings, sealed with
// STEWARD_CREDENTIAL_KEY (set). Mailchimp, Gmail, Outlook and Xero are OAuth
// and each one's client id, secret and redirect URI are set on Railway.
// Spreadsheets, the bookkeeper file and the open API need no credential.
//
// DONORBOX IS NOT LIVE, though the brief listed it. There is no Donorbox
// adapter: shared/givingSources.js carries eight providers and Donorbox is
// not one of them, and every other mention of the name in the codebase is a
// comment or the free-text "other source" field. Nobody can connect it from
// Settings today, so it keeps its honest label.
//
// QuickBooks Online stays Coming per the brief, though INTUIT_CLIENT_ID and
// INTUIT_CLIENT_SECRET are now set; Zapier needs its app submitted, Constant
// Contact needs its keys, and forward-to-log moves to Live the day the
// FIX-11 Part 5 BCC test is confirmed landing on a donor.
export const CONNECTIONS = [
  ["Stripe", "Gifts and payouts flow in; every payout matched to its gifts.", "Live"],
  ["Spreadsheets and CSV", "Any export, mapped once and remembered.", "Live"],
  ["Bookkeeper file", "A monthly gift file that foots to the cent.", "Live"],
  ["Open API", "Scoped keys and webhooks for your own tools.", "Live"],
  ["Mailchimp", "Audiences and tags kept in step with Steward.", "Live"],
  ["Gmail and Outlook", "Emails with donors land on their profile. Google shows a one-time unverified-app screen until our verification is finished.", "Live"],
  ["PayPal", "Gifts come in and are watched for gaps.", "Live"],
  ["Givebutter", "Campaign gifts pulled in.", "Live"],
  ["Square", "Sales and donations read in.", "Live"],
  ["Xero", "Sending gifts to your books. Connects today; sending is not available yet.", "Coming"],
  ["Donorbox", "Gifts and recurring plans pulled in.", "Coming"],
  ["QuickBooks Online", "Direct connection.", "Coming"],
  ["Zapier", "Connect hundreds of other tools.", "Coming"],
  ["Constant Contact", "List sync.", "Coming"],
  ["Forward-to-log email", "Copy a Steward address on any email to log it.", "Coming"],
];

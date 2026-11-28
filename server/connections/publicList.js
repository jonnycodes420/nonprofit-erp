// server/connections/publicList.js · HONEST-2 item 2 (W-1126-Integrations-05).
// THE PUBLIC CONNECTIONS LIST, IN SETTINGS' THREE GROUPS.
//
// The sweep of 26 Nov: "public pages list file-only and unavailable tools as connections". The site
// kept its own hand-typed table (Square and Mailchimp "Live" while Settings said "not available
// yet"; Cash App, Venmo and Toast nowhere, though Settings brings them in as files). The site now
// reads this list, built from the registries Settings reads, so the two say the same thing:
//
//   connects  Settings shows a card you connect (an account, a key or an address)
//   files     Settings shows "Bring in a file": a file somebody drops in, never a connection
//   notYet    Settings shows "Not available yet": the consent screen isn't set up, or it is held
//
// A tool appears in exactly one group. Readiness is the same test as GET /oauth/status: the client
// id, secret and redirect URI are set and the provider is not held. No value is ever returned.
"use strict";

const LINES = {
  stripe: "Gifts and payouts flow in; every payout matched to its gifts.",
  paypal: "Gifts come in and are watched for gaps.",
  zeffy: "Gifts come in and are watched for gaps.",
  givebutter: "Campaign gifts pulled in.",
  square: "Sales and donations read in.",
  intuit: "Each gift sent to your books, fund by fund.",
  xero: "Each gift sent to your books as one bank transaction.",
  mailchimp: "Your audience read in, and campaigns read back.",
  constantcontact: "Your list read in, and campaigns read back.",
  inbox: "Emails and meetings with people on file land on their timeline.",
  bcc: "Copy a Steward address on any email to log it to the person it names.",
  api: "Scoped keys for your own tools.",
  webhooks: "Steward posts to an address you choose when something happens.",
  // HONEST-4 item 5: Zapier is one line, as Zapier. What its app triggers and does, never the apps it reaches.
  zapier: "Connect to 6,000+ apps. Starts a Zap on New gift, New person or Stage changed; can Create person, Record gift or Add note. Uses an API key.",
  bookkeeperFile: "A monthly gift file that foots to the cent. Nothing to connect.",
  statements: "A bank statement, a spreadsheet or any export, mapped once and remembered.",
  donorbox: "Its gift export comes in as a file.",
  file: "Its export comes in as a file. Steward reads the file; it never reaches the provider.",
};

async function oauthReadyMap() {
  // The same readiness test GET /connections and GET /oauth/status use (honest.js oauthReadiness).
  return { out: await require("./honest").oauthReadiness(), O: await import("../../shared/oauth.js") };
}

async function publicConnections() {
  const { PROVIDERS, providerLabel } = await import("../../shared/givingSources.js");
  const { out: ready, O } = await oauthReadyMap();
  const oauthOfVendor = {};
  for (const k of O.PROVIDER_KEYS) oauthOfVendor[O.vendorKeyOf(k)] = k;
  const g = { connects: [], files: [], notYet: [] };
  const put = (group, key, name, line) => g[group].push({ key, name, line });
  put("connects", "stripe", "Stripe", LINES.stripe);
  for (const key of Object.keys(PROVIDERS)) {
    if (key === "stripe") continue;   // Stripe's history is the second half of the Stripe card
    const name = providerLabel(key);
    if (PROVIDERS[key].mode === "file") { put("files", key, name, LINES.file); continue; }
    const o = oauthOfVendor[key];
    put(o && !ready[o] ? "notYet" : "connects", key, name, LINES[key] || LINES.paypal);
  }
  for (const [o, name] of [["intuit", "QuickBooks Online"], ["xero", "Xero"], ["mailchimp", "Mailchimp"], ["constantcontact", "Constant Contact"]])
    if (O.PROVIDERS[o]) put(ready[o] ? "connects" : "notYet", o, name, LINES[o]);
  const inbox = ["google", "microsoft"].filter(k => ready[k]);
  put(inbox.length ? "connects" : "notYet", "inbox", inbox.length === 1 ? (inbox[0] === "google" ? "Gmail" : "Outlook") : "Gmail and Outlook", LINES.inbox);
  put("connects", "bcc", "BCC address", LINES.bcc);
  put("connects", "bookkeeper-file", "Bookkeeper file", LINES.bookkeeperFile);
  // HONEST-4 item 5: Zapier, API keys and webhooks sit under one "Build your own" heading, as in Settings.
  const g2 = g.build = [];
  g2.push({ key: "zapier", name: "Zapier", line: LINES.zapier });
  g2.push({ key: "api", name: "Open API", line: LINES.api });
  g2.push({ key: "webhooks", name: "Webhooks", line: LINES.webhooks });
  put("files", "statements", "Spreadsheets and statements", LINES.statements);
  put("files", "donorbox", "Donorbox", LINES.donorbox);
  return g;
}

const GROUP_WORDS = {
  connects: { title: "Connects", sentence: "Connect it yourself from Settings today, or with us on your setup call." },
  build: { title: "Build your own", sentence: "Zapier, API keys and webhooks, for tools Steward does not connect to itself." },
  files: { title: "Import from a file", sentence: "Not a connection: its export comes in as a file, and Steward reads the file." },
  notYet: { title: "Not available yet", sentence: "Steward can't connect to these yet. Tell us you need one and we'll say when it's ready." },
};

function mount(app, { wrap }) {
  app.get("/public/connections", wrap(async (req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    // HONEST-3 item 3 (W-1126-Integrations-05): "public pages still list file-only and unavailable tools
    // as connections". The site lists only what connects today, file tools under their own "Import from
    // a file" heading, and nothing that isn't available. Settings keeps its third group.
    const { connects, build, files } = await publicConnections();
    res.json({ groups: { connects, build, files }, words: { connects: GROUP_WORDS.connects, build: GROUP_WORDS.build, files: GROUP_WORDS.files } });
  }));
}

module.exports = { mount, publicConnections, GROUP_WORDS, LINES };

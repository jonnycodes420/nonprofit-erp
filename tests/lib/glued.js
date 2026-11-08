// tests/lib/glued.js · the glued-text check (POLISH-5), shared by POLISH-5's
// sweep and POLISH-6's suite. Pure: text in, the glued spots out.
"use strict";
const INNER_CAPS = new Set(["iPhone", "iPad", "iOS", "eBay", "PayPal", "QuickBooks", "GitHub", "LinkedIn", "YouTube", "WordPress",
  "JavaScript", "MailChimp", "SendGrid", "CiviCRM", "DonorPerfect", "NeonCRM", "eTapestry", "GoFundMe", "JustGiving", "OneCause",
  "GiveSmart", "GiveButter", "FreshBooks", "SharePoint", "OneDrive", "DocuSign", "TikTok", "WhatsApp", "MacArthur", "McDonald",
  "DeShawn", "LaToya", "DuPont", "BlackBaud", "PostgreSQL", "TypeScript", "ZipCode", "OAuth", "AmeriCorps", "GuideStar",
  "SmartSheet", "LittleGreenLight", "RaisersEdge", "NetSuite", "BambooHR", "ConstantContact", "HubSpot", "SalesForce", "MacBook", "VolunteerHub", "SignUpGenius", "MyStewardApp", "WebP", "LawnCare"]);
function glued(text) {
  const out = [];
  const push = (rule, m, s) => out.push(`${rule}: …${s.slice(Math.max(0, m.index - 18), m.index + m[0].length + 18).replace(/\s+/g, " ")}…`);
  for (const line of String(text || "").split("\n")) {
    // tokens that are not prose: addresses, links, ids, file names
    const s = line.replace(/\S*(?:@|https?:\/\/|www\.|\/|_|\.(?:com|org|dev|net|xlsx|csv|pdf|png|jpg))\S*/gi, " ");
    let m;
    const dollarBefore = /[A-Za-z0-9]\$\d/g;
    while ((m = dollarBefore.exec(s))) push("glued before $", m, s);
    const dollarAfter = /\$\d[\d,]*(?:\.\d+)?(?![KkMmBb]\b)[A-Za-z]/g;
    while ((m = dollarAfter.exec(s))) push("glued after $", m, s);
    const caps = /[A-Za-z]*[a-z]{2}[A-Z][A-Za-z]*/g;
    while ((m = caps.exec(s))) if (!INNER_CAPS.has(m[0])) push("capital glued to a word", m, s);
    const period = /[a-z0-9]{2}\.[A-Z][a-z]/g;
    while ((m = period.exec(s))) push("period glued to a word", m, s);
    // POLISH-6 (W-1107-Atlas-19X): a colon glued to the next word ("Not sent:pledge reminders"); a time (10:30) is not
    const colon = /[A-Za-z]{2}:[A-Za-z]{2}/g;
    while ((m = colon.exec(s))) push("colon glued to a word", m, s);
  }
  return out;
}
module.exports = { glued, INNER_CAPS };

// middleware/fieldCaps.js — SECURE-2 item 3. NO FIELD LONGER THAN IT SHOULD BE.
//
// Every write (POST, PUT, PATCH) passes through here after the JSON parser,
// above every router that comes after it. A text field longer than its cap is
// refused with one plain sentence ("The name is too long: 263 characters. The
// most is 200."), before the route runs, so nothing is half-written.
//
// Caps are by the field's name, wherever it sits in the body. Anything else
// has the general cap. A data: URL (a photo on its way to the uploader) and
// the import doors are not capped here: an import keeps what the file says
// (the importers trim cells themselves) and a photo has its own byte limit.
"use strict";

const CAPS = [
  [/^(name|firstname|lastname|middlename|fullname|preferredname|nickname|orgname|organization|organisation|employer|title|jobtitle|label|fundname|campaignname|contactname|username|displayname)$/, 200, "name"],
  [/^(email|email2|contactemail|replyto)$/, 254, "email address"],
  [/^(phone|phone2|mobile|cell)$/, 50, "phone number"],
  [/^(city|zip|zipcode|postalcode|country)$/, 100, null],   // not "state": an OAuth state is long
  [/^(address|address1|address2|street|line1|line2)$/, 300, "address"],
  [/^(subject|previewtext|preheader)$/, 300, "subject"],
  [/^(note|notes|description|message|bio|mission|summary|reason|comment|memo|instructions|answer)$/, 20000, null],
  [/^(body|html|text|content|bodyhtml|bodytext|template)$/, 500000, null],
];
const GENERAL = 1000000;
const CUSTOM = 5000;   // one custom field's value
const SKIP_PATHS = /^\/(donors\/import|gifts\/import|history-import|setup\/runs|admin\/orgs\/[^/]+\/setup|sheets|imports|grants\/import|screening\/import|data-health\/ncoa|pictures|media|portal-settings|portal-page|impact-updates|events\/[^/]+\/(hero|photos)|stripe\/webhook|billing\/webhook|webhooks?\/)/;

const norm = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
function capFor(key, parentKey) {
  if (/custom/i.test(String(parentKey || ""))) return [CUSTOM, "custom field"];
  const k = norm(key);
  for (const [re, n, word] of CAPS) if (re.test(k)) return [n, word || String(key).replace(/_/g, " ")];
  return [GENERAL, String(key).replace(/_/g, " ")];
}
function firstTooLong(v, key, parentKey, depth) {
  if (depth > 6 || v == null) return null;
  if (typeof v === "string") {
    if (/^data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(v)) return null;
    const [cap, word] = capFor(key, parentKey);
    return v.length > cap ? { key, word, len: v.length, cap } : null;
  }
  if (Array.isArray(v)) { for (const x of v) { const r = firstTooLong(x, key, parentKey, depth + 1); if (r) return r; } return null; }
  if (typeof v === "object") { for (const k of Object.keys(v)) { const r = firstTooLong(v[k], k, key, depth + 1); if (r) return r; } }
  return null;
}
function fieldCaps() {
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH"].includes(req.method) || !req.body || typeof req.body !== "object") return next();
    if (SKIP_PATHS.test(req.path)) return next();
    const hit = firstTooLong(req.body, "", "", 0);
    if (!hit) return next();
    const what = hit.word ? `The ${hit.word}` : "One of the fields";
    const sentence = `${what} is too long: ${hit.len.toLocaleString("en-US")} characters. The most is ${hit.cap.toLocaleString("en-US")}.`;
    return res.status(400).json({ error: sentence, message: sentence, field: hit.key || null, code: "too_long" });
  };
}
module.exports = { fieldCaps, capFor, CAPS, GENERAL };

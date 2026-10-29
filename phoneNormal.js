// phoneNormal.js — SECURE-2 item 3. ONE FORMAT FOR A PHONE NUMBER, BY LIBPHONENUMBER.
//
// A US number is stored "(859) 555-0142" (what shared/phone.js shows); any
// other country's as "+44 20 7946 0958". An extension is kept ("ext. 12").
// A form refuses what is not a phone at all and keeps a local number it
// cannot place as typed; an import keeps it as typed and
// flags it, because a person's file is not ours to throw away.
"use strict";
const { parsePhoneNumberFromString } = require("libphonenumber-js");

function normalPhone(raw, country = "US") {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: "" };
  const p = parsePhoneNumberFromString(s, country);
  if (!p || !p.isValid()) {
    // A number libphonenumber cannot place (a local "555-0142" with no area
    // code) is kept as typed. Only what is not a phone at all is refused:
    // fewer than 7 digits, more than 15, or words other than an extension.
    const digits = s.replace(/\D/g, "").length;
    const words = s.replace(/\b(ext|extension|x)\b\.?/gi, "").replace(/[^A-Za-z]/g, "");
    if (digits >= 7 && digits <= 15 && !words) return { ok: true, value: s };
    return { ok: false, value: s, sentence: `"${s.slice(0, 40)}" is not a phone number Steward can dial. Check the digits, or leave it blank.` };
  }
  return { ok: true, value: (p.country === "US" ? p.formatNational() : p.formatInternational()) };
}
module.exports = { normalPhone };

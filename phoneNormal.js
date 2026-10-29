// phoneNormal.js — SECURE-2 item 3. ONE FORMAT FOR A PHONE NUMBER, BY LIBPHONENUMBER.
//
// A US number is stored "(859) 555-0142" (what shared/phone.js shows); any
// other country's as "+44 20 7946 0958". An extension is kept ("ext. 12").
// A form refuses a number that is not one; an import keeps it as typed and
// flags it, because a person's file is not ours to throw away.
"use strict";
const { parsePhoneNumberFromString } = require("libphonenumber-js");

function normalPhone(raw, country = "US") {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: "" };
  const p = parsePhoneNumberFromString(s, country);
  if (!p || !p.isValid()) return { ok: false, value: s, sentence: `"${s.slice(0, 40)}" is not a phone number Steward can dial. Check the digits, or leave it blank.` };
  return { ok: true, value: (p.country === "US" ? p.formatNational() : p.formatInternational()) };
}
module.exports = { normalPhone };

// contactInputs.js — SECURE-2 item 3. THE ONE CHECK A FORM'S EMAIL AND PHONE PASS.
//
// Sign-up, invites, the donor forms and Tell Steward's contact edits call
// this before they write. An email must be a real address (shared/
// contactCheck.js: no "a@b"); a phone must be a number libphonenumber can
// dial, and is stored in one format (phoneNormal.js). A refusal is one plain
// sentence, with the "did you mean" hint when there is one. Imports never
// come through here: they keep what the file says and flag it.
"use strict";
const { normalPhone } = require("./phoneNormal");
let CC = null;
const cc = async () => CC || (CC = await import("./shared/contactCheck.js"));

// fields: { email: ["email", "email2"], phone: ["phone"] }. Returns
// { error, field } or { values } with the normalised phones (emails trimmed).
async function checkContact(body, fields) {
  const { emailProblem, emailHint } = await cc();
  const values = {};
  for (const k of fields.email || []) {
    if (body[k] == null || String(body[k]).trim() === "") continue;
    const v = String(body[k]).trim();
    const p = emailProblem(v);
    if (p) {
      const hint = emailHint(v);
      return { field: k, error: `${p}${hint ? ` (${hint})` : ""}` };
    }
    values[k] = v;
  }
  for (const k of fields.phone || []) {
    if (body[k] == null || String(body[k]).trim() === "") continue;
    const r = normalPhone(body[k]);
    if (!r.ok) return { field: k, error: r.sentence };
    values[k] = r.value;
  }
  return { values };
}
// The flags a profile and an import preview show for a stored value: never a
// refusal, a note to check it.
async function contactFlags(row) {
  const { emailProblem, emailHint } = await cc();
  const flags = [];
  for (const k of ["email", "email2"]) {
    const v = row && row[k];
    if (!v) continue;
    const p = emailProblem(v), hint = emailHint(v);
    if (p || hint) flags.push({ field: k, label: "Check this email", sentence: p || hint, hint });
  }
  if (row && row.phone && !normalPhone(row.phone).ok) flags.push({ field: "phone", label: "Check this phone", sentence: normalPhone(row.phone).sentence });
  return flags;
}
module.exports = { checkContact, contactFlags };

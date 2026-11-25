// server/mail/giftPreview.js · NUMBERS-8 item 6 (W-1125-Fundraising-17). A THANK-YOU NEVER THANKS
// SOMEONE FOR A GIFT THEY DIDN'T MAKE.
//
// The fleet previewed "Thank you, major gift" as Ana Ruiz, who has never given, and read "Thank you
// for your gift of your gift." The preview started from the brand kit's sample person ($250 gift),
// laid the real person over it, and a real person with no gift has empty gift fields, which were
// skipped, so the sample's gift stayed, the gift sentence was kept, and the merge filled the empty
// field with its own fallback label ("your gift").
//
// So: previewed as a real person, a gift field is that person's or empty, never the sample's; and a
// template that speaks of a gift, previewed as someone who has none, says so instead of drawing the
// letter: "Ana hasn't given yet. Preview this as someone who has." with the newest giver offered.
// Sending one is refused the same way (routes/templates.js usable(): "nothing on file for: gift amount").
"use strict";

const GIFT_FIELDS = ["gift_amount", "last_gift_amount", "gift_date", "last_gift_date"];
const GIFT_TOKEN = new RegExp(`\\{\\{\\s*(?:${GIFT_FIELDS.join("|")})\\s*\\}\\}`);

// Does this template's text use a gift field (its blocks, subject or preheader)?
function usesGift(row) {
  return GIFT_TOKEN.test(`${JSON.stringify((row && row.blocks) || [])} ${(row && row.subject) || ""} ${(row && row.preheader) || ""}`);
}

// The sample's gift fields cleared, so only the real person's own can fill them.
function withoutSampleGift(fields) {
  const out = { ...fields };
  for (const k of GIFT_FIELDS) out[k] = "";
  return out;
}

const firstOf = name => String(name || "").trim().split(/\s+/)[0] || "This person";

// The notice for a gift template previewed as someone with no gift, or null. `fields` are the
// preview's fields after the person's own were laid on; `lastGiver` the newest giver { id, name }.
function noGiftNotice(row, person, fields, lastGiver) {
  if (!person || !usesGift(row)) return null;
  if (GIFT_FIELDS.some(k => String(fields[k] || "").trim() !== "")) return null;
  const first = firstOf(person.name);
  return {
    sentence: `${first} hasn't given yet. Preview this as someone who has.`,
    lastGiver: lastGiver && lastGiver.id !== person.id ? lastGiver : null,
  };
}

// What the preview pane shows in place of the letter.
function noticeHtml(n) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<div data-no-gift="1" style="font-family:system-ui,sans-serif;font-size:15px;color:#0F1A12;padding:48px 32px;text-align:center;line-height:1.6">`
    + `<p style="margin:0 0 8px;font-weight:700">${esc(n.sentence)}</p>`
    + (n.lastGiver ? `<p style="margin:0;color:#0F1A12">Press Preview as ${esc(n.lastGiver.name)}, above, to see it for your newest giver.</p>` : "")
    + `</div>`;
}

module.exports = { GIFT_FIELDS, usesGift, withoutSampleGift, noGiftNotice, noticeHtml };

// SAFE-EDIT-1 item 1 · ONE KEY PER FORM. A create a double-click can repeat (a person, a
// task, a gift, a pledge) carries one key for as long as its form is open; the server
// answers every repeat of the key with the row the first request made
// (server/shared/requestKey.js; gifts and pledges keep theirs in idempotency_key).
// A new key only after a create succeeded, so a corrected resend after a refusal is the same try.
export function newRequestKey() {
  const raw = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return "rk_" + raw.replace(/[^A-Za-z0-9]/g, "");
}

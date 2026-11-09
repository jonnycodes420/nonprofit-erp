// shared/mailHeader.js · POLISH-8 (W-1107-Fundraising-20, repeat).
// The header of Settings, "What Steward sends automatically", is DERIVED from
// the switches under it, never static copy. It said "Steward sends nothing on
// its own until you turn it on here. Each email starts off." on a page that
// also said email was turned on Nov 3 and Journey and sequence steps was On.
//
//   mailHeader({ mailOn, types })  types: [{ name, on }] as the page shows them
//     email on, some on   "Email is on. These send on their own: journey and sequence steps."
//     email on, none on   "Email is on. Nothing sends on its own yet: every email below is off."
//     email off           "Email is off. Nothing sends on its own."
// Pure, JSX-free: the server's page payload and the screen read the same call.
export function joinWords(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

export function mailHeader({ mailOn, types } = {}) {
  if (!mailOn) return "Email is off. Nothing sends on its own.";
  const on = (types || []).filter(t => t && t.on).map(t => String(t.name || "").toLowerCase()).filter(Boolean);
  if (!on.length) return "Email is on. Nothing sends on its own yet: every email below is off.";
  return `Email is on. These send on their own: ${joinWords(on)}.`;
}

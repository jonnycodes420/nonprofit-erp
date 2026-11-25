// POLISH-5 · THE NEXT MOVE, SAID THE WAY A PERSON SAYS IT. The profile's
// move read "Upgraded on their own: visit, between Nov 5, 2026 and Dec 5,
// 2026." — a card's title, a colon and a channel. It names the step and the
// person now: "Visit Marlowe between Nov 5, 2026 and Dec 5, 2026." The card's
// title stays above it as the eyebrow. JSX-free so a suite can import it.

const VERB = {
  visit: who => `Visit ${who}`,
  call: who => `Call ${who}`,
  note: who => `Write ${who} a note`,
  letter: who => `Send ${who} a letter`,
  email: who => `Email ${who}`,
};

// how: the move's { channel, when: { words } }; firstName may be empty.
export function moveSentence(how, firstName, title) {
  const h = how || {};
  const who = String(firstName || "").trim() || "them";
  const verb = VERB[String(h.channel || "").toLowerCase()];
  const when = h.when && h.when.words ? String(h.when.words) : "";
  if (!verb) return when ? `Reach out to ${who} ${when}.` : (title ? `${title}.` : `Reach out to ${who}.`);
  return when ? `${verb(who)} ${when}.` : `${verb(who)}.`;
}

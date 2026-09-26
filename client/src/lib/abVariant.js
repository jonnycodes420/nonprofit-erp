// client/src/lib/abVariant.js — BUILD-102 (Steward Give) Part 6.
// WHICH SIDE OF AN A/B A VISITOR IS ON, decided once and remembered.
//
// A cookie rather than a server-side assignment, for one reason: the assignment has
// to happen BEFORE the form's spec is fetched, and a round trip to ask which side
// somebody is on is a round trip in front of a donation form. Fifty-fifty from
// `crypto.getRandomValues` — not `Math.random`, which is fine for a coin flip but
// is the wrong habit to build in a file about money.
//
// IT IS NOT AN IDENTIFIER. The cookie holds one letter, "a" or "b". It cannot
// identify anybody, it is not sent to any third party, and the server's
// `form_events` table has nowhere to record it against a person even if it were.
//
// A visitor who returns stays on the same side, because a donor who saw version B
// on Tuesday and version A on Friday makes both numbers mean less.

const COOKIE = "steward_give_ab";
const DAYS = 90;

function read() {
  try {
    const m = new RegExp("(?:^|; )" + COOKIE + "=([ab])(?:;|$)").exec(document.cookie);
    return m ? m[1] : null;
  } catch { return null; }
}

function write(v) {
  try {
    const exp = new Date(Date.now() + DAYS * 86400000).toUTCString();
    // SameSite=Lax so it survives a normal click-through from an email, and the
    // Secure flag on https only — a cookie this small does not need to be a
    // problem on a local http preview.
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${v}; path=/; expires=${exp}; SameSite=Lax${secure}`;
  } catch { /* a browser refusing cookies still gets a form, on side A */ }
}

function coin() {
  try {
    const b = new Uint8Array(1);
    window.crypto.getRandomValues(b);
    return b[0] % 2 === 0 ? "a" : "b";
  } catch { return "a"; }
}

// `running` is false for a form with no test, and then EVERYBODY is on A — no
// cookie is set, because a cookie nobody needs is a cookie that has to be explained
// in a privacy policy.
export function assignVariant(running) {
  if (!running) return null;
  const had = read();
  if (had) return had;
  const v = coin();
  write(v);
  return v;
}

export function currentVariant() { return read(); }

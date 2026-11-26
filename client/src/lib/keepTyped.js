// INPUT-1 item 2 · AN AUTOSAVE NEVER TAKES A SPACE OUT OF WHAT SHE IS TYPING.
//
// The page editors save a draft a second after each pause, and take back the
// server's copy of it (data-URI images become asset paths, colours are
// normalised). The server tidies words too: it trims the ends and squeezes
// runs of spaces. Taken back mid-sentence, "Every " came home as "Every" in
// the box she was typing in, and the next word ran on: "Everygift helps"
// (Jarvis's sweep, 25 Nov). So a word the server only tidied stays as she
// typed it; anything the server really changed is taken. The ends are trimmed
// where they always were, on the server, so the saved page is the same.
const squeeze = s => s.replace(/\s+/g, " ").trim();

export function keepTyped(mine, theirs) {
  if (typeof mine === "string" && typeof theirs === "string") return mine !== theirs && squeeze(mine) === squeeze(theirs) ? mine : theirs;
  if (Array.isArray(mine) && Array.isArray(theirs)) return mine.length === theirs.length ? theirs.map((t, i) => keepTyped(mine[i], t)) : theirs;
  if (mine && theirs && typeof mine === "object" && typeof theirs === "object" && !Array.isArray(mine) && !Array.isArray(theirs)) {
    const out = { ...theirs };
    for (const k of Object.keys(theirs)) if (k in mine) out[k] = keepTyped(mine[k], theirs[k]);
    return out;
  }
  return theirs;
}

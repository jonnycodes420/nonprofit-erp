// shared/draftAbout.js · FLOWS-18 item 6 (W-1113-Donors-26, the third time).
// DRAFT AN EMAIL OPENS WITH WHAT THE TEAM KNOWS ABOUT THEM.
//
// Brief me and Call script read the person's About note; Draft an email did not use it:
// "Dear Margaret, Thank you for your gift of $15,000 on September 14, 2026. It made a real
// difference here." with no Harbor Skills Boat, no Lily, no pottery wheel.
//   · FLOWS-10 handed the note to the model and kept DATES-1's instruction beside it: "for tone
//     only; do not quote it or state any of it in the email". The model obeyed.
//   · FLOWS-12 and FLOWS-10's template path (routes/atlasMore.js oneFact) named one fact, the last
//     gift, else the last conversation, and never the note.
// Now both paths carry the note's detail in the opening lines: the model is told to, and a draft
// that leaves it out is not used (the template is); the template writes it itself.

// HONEST-2 item 6 (W-1126-Fundraising-03): a note typed "QA A1 About: loves the pottery wheel" reached a
// donor's thank-you verbatim, label and all. A note's LABELS are never its meaning: a test marker
// ("QA", "TEST", "A1"), a field label ("About:", "Note:", "Background:") or a bracketed tag at the start
// of the note or of any sentence in it is taken off before a draft reads the note. The guard
// (shared/suggestionGuard.js guardDraft) refuses a draft that still carries one.
const LABEL_RUN = /^(?:\s*(?:\[[^\]]{0,30}\]|\((?:qa|test)[^)]{0,20}\)|(?:QA|TEST|TESTING|TODO|FIXME|XXX|DEMO|SAMPLE|DRAFT)\b|[A-Z]{1,3}\d{1,3}\b|(?:about(?: them| him| her)?|note|notes|background|bio|context|internal|staff note|re)\s*:)[\s:;.,\-–—]*)+/i;
export function cleanAbout(about) {
  const s = String(about || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.split(/(?<=[.!?])\s+/).map(part => {
    // A sentence-starting word is a label only when it is one of the markers or ends in a colon.
    let p = part, prev;
    do { prev = p; p = p.replace(LABEL_RUN, m => (/[:\]\)]|\b(?:QA|TEST|TESTING|TODO|FIXME|XXX|DEMO|SAMPLE|DRAFT)\b|^\s*[A-Z]{1,3}\d{1,3}\b/.test(m) ? "" : m)).trim(); } while (p !== prev);
    return p ? p[0].toUpperCase() + p.slice(1) : "";
  }).filter(Boolean).join(" ");
}

// The detail a note names: its proper names and multi-word names ("Harbor Skills Boat", "Lily"),
// then its longer plain words. What a draft must carry at least one of.
const STOP = new Set(["the", "and", "she", "her", "his", "him", "they", "them", "their", "with", "from", "that", "this", "about", "who",
  "has", "have", "had", "was", "were", "loves", "likes", "said", "says", "also", "very", "really", "always", "never", "would", "could",
  "should", "because", "when", "where", "which", "what", "into", "onto", "over", "after", "before", "every", "years", "year"]);
export function aboutDetails(about, { name = "" } = {}) {
  const s = cleanAbout(about);
  if (!s) return [];
  const names = [];
  // Capitalised runs that do not just start a sentence (or that are two words or more).
  const re = /(^|[.!?]\s+|\s)((?:[A-Z][a-z'’]+)(?:\s+(?:of|the|and|&)?\s*[A-Z][a-z'’]+)*)/g;
  let m;
  while ((m = re.exec(s))) {
    const run = m[2].trim();
    const startsSentence = /^$|[.!?]\s+$/.test(m[1]);
    if (run.includes(" ") || !startsSentence) names.push(run);
  }
  // The person's own name is no detail: every draft says it.
  const own = new Set(String(name || "").toLowerCase().split(/\s+/).filter(Boolean));
  const named = [...new Set(names)].filter(x => !x.toLowerCase().split(/\s+/).every(w => own.has(w)));
  if (named.length) return named.slice(0, 12);
  const words = (s.toLowerCase().match(/[a-z][a-z'’-]{4,}/g) || []).filter(w => !STOP.has(w) && !own.has(w));
  return [...new Set(words)].slice(0, 12);
}

// The note, cut at a sentence end near `max` characters, ending in a full stop.
export function clipNote(about, max = 240) {
  const s = cleanAbout(about);
  if (!s) return "";
  if (s.length <= max) return /[.!?]$/.test(s) ? s : s + ".";
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 40 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

// The template's line, for the opening: the note's own words, said to the person, for her to
// put in her voice before she sends it (a draft is never sent without her).
// HONEST-2 item 6: the note's meaning, not its text. When it names people, places or programs, the
// line speaks of them; otherwise it carries the note's own words, cleaned of labels (cleanAbout).
export function aboutOpening(about, { name = "" } = {}) {
  const note = clipNote(about);
  if (!note) return null;
  const named = aboutDetails(about, { name }).filter(d => /^[A-Z]/.test(d)).slice(0, 3);
  if (named.length) return `I keep thinking about ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`}, and what you have shared with us.`;
  return `I have been thinking about what you have shared with us: ${note[0].toLowerCase() + note.slice(1)}`;
}

// Whether a draft's opening lines (the three after the greeting) carry the note's detail.
export function opensWithAbout(body, about, { name = "" } = {}) {
  const details = aboutDetails(about, { name });
  if (!details.length) return true;
  // The three lines after the greeting.
  const lines = String(body || "").split(/\n+/).map(l => l.trim()).filter(Boolean).slice(1, 4).join(" ").toLowerCase();
  return details.some(d => lines.includes(d.toLowerCase()));
}

// What the model is told about the note (replaces DATES-1's "for tone only").
export function aboutInstruction(about) {
  const a = cleanAbout(about).slice(0, 500);
  return a ? `\nWhat the team knows about them: ${a}\nIn the first two sentences after the greeting, speak to them about the detail in that note (the program, the people or the thing it names), in your own words: never copy the note. State nothing beyond what the note says.` : "";
}

// The draft with AI off (and when a model's draft is not used): the greeting, one fact from the
// record (FLOWS-10), then the About note's detail (FLOWS-18), then the meeting and the sign-off.
export function draftTemplate({ firstName, fullName = "", opening = "", fact = null, thanks = false, meet = false, month = "", aboutThem = "", voice = {} } = {}) {
  // HONEST-2 item 6: the draft always names the person it is to.
  firstName = String(firstName || "").trim() || String(fullName || "").trim().split(/\s+/)[0] || "";
  const aboutLine = aboutOpening(aboutThem, { name: fullName || firstName });
  return { subject: thanks || fact ? `Thank you, ${firstName}` : `A note for ${firstName}`,
    body: [opening || `Dear ${firstName},`, "", fact || (thanks ? "Thank you so much for your generosity. It means a great deal to all of us." : "Thank you for being part of what we do."),
      ...(aboutLine ? ["", aboutLine] : []),
      ...(meet ? ["", `I would love to meet${month ? ` in ${month}` : ""} to share what your support makes possible. Would that work for you?`] : []),
      "", `${(voice && voice.signoff) || "With gratitude"},`, ...(voice && voice.signature ? [voice.signature] : [])].join("\n") };
}

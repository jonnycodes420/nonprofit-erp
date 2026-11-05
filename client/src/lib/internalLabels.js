// POLISH-5 · STEWARD'S OWN BOOKKEEPING NEVER READS AS A PERSON'S RECORD.
// A one-off demo seed tagged its people "demo-file" and wrote "From the demo
// file (BUILD-89)." on their notes. Those rows stay as they are (no row
// changes); a profile just doesn't show them. The tag is still on the record
// (Finance reads it to call those gifts sample), so editing tags keeps it.
// JSX-free so a suite can import it.

const INTERNAL_TAG = /^(?:demo-file|BUILD-\d+[A-Za-z]*)$/i;
export function shownTags(tags) {
  return (Array.isArray(tags) ? tags : []).filter(t => !INTERNAL_TAG.test(String(t).trim()));
}

// The note without the seed's line or a build reference in brackets.
export function shownNote(text) {
  return String(text == null ? "" : text)
    .replace(/From the demo file \(BUILD-\d+[A-Za-z]*\)\.?/gi, "")
    .replace(/\s*\((?:see )?BUILD-\d+[A-Za-z]*(?:\s+[^)]*)?\)/g, "")
    .replace(/[ \t]{2,}/g, " ").trim();
}

// donorTags.js · FIX-33. A person's tags, as a screen may show them.
//
// `donors.tags` holds two kinds of thing: the tags a person typed or imported
// ("Board", "Gala 2025") and machine flags a step wrote for itself. The import
// writes `has-refused-rows:N` so drift can hedge its gap claim (BUILD-80 Part
// 2.4). A machine flag is never shown as a tag: it read "HAS-REFUSED-ROWS:2"
// under a donor's name. It is said instead as a plain line, to admins only,
// with a link to the rows (routes/profileStatus.js, GET /donors/:id/refused-rows).
//
// The API filters here, so no surface (list, profile, export, search) has to
// remember to. A write keeps the flags the client never saw (keepInternal), so
// editing a person's tags cannot erase the hedge.

// Every internal flag matches one of these. A new machine flag is added here.
const INTERNAL_TAG_RES = [/^has-refused-rows:\d+$/i];

const parse = raw => {
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};
const isInternalTag = t => INTERNAL_TAG_RES.some(re => re.test(String(t).trim()));
const visibleTags = raw => parse(raw).filter(t => !isInternalTag(t));
const internalTags = raw => parse(raw).filter(isInternalTag);
// The incoming list (what the person saw and edited) plus the flags already on
// the row, once each.
const keepInternal = (existingRaw, incoming) =>
  [...new Set([...parse(incoming).filter(t => !isInternalTag(t)), ...internalTags(existingRaw)])];
// How many of this person's import rows could not be read, from the flag.
function refusedRowsOf(raw) {
  let n = 0;
  for (const t of parse(raw)) { const m = /^has-refused-rows:(\d+)$/i.exec(String(t).trim()); if (m) n += Number(m[1]); }
  return n;
}

module.exports = { INTERNAL_TAG_RES, isInternalTag, visibleTags, internalTags, keepInternal, refusedRowsOf };

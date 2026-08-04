// BUILD-32 — pure, JSX/React-free campaign fuzzy-matcher, kept in a lib (like
// money.js / importShape.js) so the Node suite can unit-test it directly
// (tests/gift-attribution.test.js dynamic-imports it) AND the gift forms can
// import it for the "Did you mean <Campaign>?" suggestion when a user types a
// designation string that matches an existing campaign name.
//
// The whole point (BUILD-32 Part 1): "Designation" is a free-text field. When
// someone types "Spring Studio Scholarships" into it, we must NOT silently drop
// a name that IS a real campaign — we offer it as a one-tap attribution. This
// matcher is deliberately conservative: an ambiguous typed value (fitting >1
// campaign equally) returns no suggestion rather than mis-attributing.

// Normalize for comparison: lowercase, strip punctuation to spaces, collapse
// whitespace, trim. "Spring Studio Scholarships!" → "spring studio scholarships".
export function normalizeCampaignText(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Small bounded Levenshtein (early-outs past `max`) — tolerates a typo or a
// dropped word-char. Mirrors importShape.js's boundedLev.
function boundedLev(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function tokenSet(s) {
  return new Set(normalizeCampaignText(s).split(" ").filter(Boolean));
}

// score(typed, name) → 0..1 confidence they refer to the same campaign.
//   1.00  exact (normalized)
//   0.90  one fully contains the other as a phrase (>=2 chars)
//   0.70+ token overlap (Jaccard), or a near Levenshtein hit
// Returns 0 when there's no meaningful signal.
export function campaignMatchScore(typed, name) {
  const a = normalizeCampaignText(typed);
  const b = normalizeCampaignText(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (b.includes(a) || a.includes(b))) return 0.9;

  // Token Jaccard — "spring scholarships" vs "spring studio scholarships".
  const ta = tokenSet(a), tb = tokenSet(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? inter / union : 0;

  // Character-level Levenshtein, tolerance scaled to length (typos, not
  // different campaigns): allow ~15% edits, capped at 3.
  const max = Math.min(3, Math.floor(Math.max(a.length, b.length) * 0.15));
  const lev = max >= 1 ? boundedLev(a, b, max) : max + 1;
  const levScore = lev <= max ? 0.8 - (lev / (max + 1)) * 0.1 : 0;

  return Math.max(jaccard >= 0.5 ? 0.6 + jaccard * 0.3 : 0, levScore);
}

// bestCampaignMatch(typed, campaigns, { threshold=0.6 }) →
//   { id, name, score } of the single best campaign whose score >= threshold,
//   or null. `campaigns` = [{id, name}, ...]. Ambiguity guard: if the top two
//   distinct campaigns tie within 0.05, we return null (never mis-attribute a
//   value that fits two campaigns equally well).
export function bestCampaignMatch(typed, campaigns, opts = {}) {
  const threshold = opts.threshold == null ? 0.6 : opts.threshold;
  if (!typed || !Array.isArray(campaigns) || !campaigns.length) return null;
  const scored = campaigns
    .map(c => ({ id: c.id, name: c.name, score: campaignMatchScore(typed, c.name) }))
    .filter(c => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.05) return null;
  return scored[0];
}

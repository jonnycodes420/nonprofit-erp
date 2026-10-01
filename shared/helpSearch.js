// shared/helpSearch.js — HELP-1. SEARCHING THE HELP CENTRE, AND THE ONE PROMPT
// ASK STEWARD MAY SEND.
//
// Ask Steward answers ONLY from help articles. That is a property of what goes
// into the prompt, so the prompt is built here, by one pure function, from two
// inputs and nothing else: the question the person typed, and the text of the
// articles search found. There is no parameter through which a donor row, an
// org name or a user record could reach it, and no tools are offered, so the
// model has nothing to call. tests/help1-ask.test.js holds the route to it.
//
// Pure: the client's search box and the server's Ask Steward both use it.

const STOP = new Set("a an and are as at be by can do does for from how i in is it my of on or the to what when where which who why will with you your".split(" "));
export const tokens = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));

export function articleText(a) {
  const out = [a.title, a.summary || ""];
  for (const s of a.sections || []) {
    out.push(s.h || "");
    for (const p of s.p || []) out.push(p);
    (s.steps || []).forEach((st, i) => out.push(`${i + 1}. ${st}`));
  }
  return out.filter(Boolean).join("\n");
}

// Title words count five times, summary twice, body once. Good enough for a
// few dozen articles, and the same ranking on the page and in Ask Steward.
export function searchArticles(articles, query, limit = 8) {
  const q = tokens(query);
  if (!q.length) return [];
  const scored = (articles || []).map(a => {
    const t = tokens(a.title), s = tokens(a.summary), b = tokens(articleText(a));
    let score = 0;
    for (const w of q) {
      if (t.includes(w)) score += 5;
      if (s.includes(w)) score += 2;
      score += Math.min(3, b.filter(x => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1)))).length);
    }
    return { a, score };
  }).filter(x => x.score >= 3);
  return scored.sort((x, y) => y.score - x.score).slice(0, limit).map(x => x.a);
}

export const HELP_SYSTEM = [
  "You are Ask Steward, the help desk inside Steward, a donor CRM for small nonprofits.",
  "Answer ONLY from the help articles below. If they do not answer the question, say plainly that the help centre does not cover it yet and suggest asking a person. Never guess and never use outside knowledge about Steward.",
  "You cannot see the person's organisation, donors or data, and you cannot take any action in Steward. If asked to do something, explain how they can do it themselves using the articles.",
  "Write in plain, calm sentences. Use numbered steps when the articles do. Do not use em dashes.",
].join(" ");

/**
 * The ONLY prompt Ask Steward sends.
 * @param question  what the person typed
 * @param articles  articles from searchArticles
 * @returns {system, messages}  and nothing else: no tools, no metadata
 */
export function buildHelpPrompt(question, articles, system = HELP_SYSTEM) {
  const q = String(question || "").trim().slice(0, 1000);
  const docs = (articles || []).map(a => `<article slug="${a.slug}">\n${articleText(a)}\n</article>`).join("\n\n");
  return {
    system,
    messages: [{ role: "user", content: `Help articles:\n\n${docs || "(none matched)"}\n\nQuestion: ${q}` }],
  };
}

export default { tokens, articleText, searchArticles, buildHelpPrompt, HELP_SYSTEM };

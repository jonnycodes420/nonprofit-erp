// CONTENT-1 · every article is one markdown file in this folder. Adding an
// article is adding a file: the index, the route table, the sitemap, the RSS
// feed and the prerendered page all read this list.
//
// The frontmatter (between the two --- lines, one `key: value` per line):
//   title        plain text, the page title and the h1 without markup
//   headline     the h1, which may use <b> for the emerald half
//   description  the search snippet and the card text
//   date         YYYY-MM-DD, the sitemap's lastmod and the feed's date
//   author       a person's name
//   kicker       the small label above the h1 ("Retention")
//   minutes      reading time
//   cover        the drawn card cover, two phrases split by " | "
//   terms        glossary slugs the article uses; each one is linked in the body
//   sources      shared/sources.js keys for every statistic in the body
//
// The body is a small, fixed markdown: ## and ### headings, paragraphs, - and
// 1. lists, **bold**, *italic*, [links](/path), a ```example block for worked
// arithmetic, and `::quote N` for research quote N. Nothing is rendered as
// raw HTML.
//
// Pure data, so Node can import it: under Vite the files come from
// import.meta.glob; in plain Node (the guard) they are read from disk.
const RAW = import.meta.env
  ? import.meta.glob("./*.md", { query: "?raw", import: "default", eager: true })
  : readFromDisk();

function readFromDisk() {
  const fs = globalThis.process.getBuiltinModule("node:fs");
  const dir = new URL(".", import.meta.url);
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".md")) out["./" + f] = fs.readFileSync(new URL(f, dir), "utf8");
  return out;
}

const LIST = new Set(["terms", "sources"]);

export function parseArticle(slug, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("article " + slug + ": no frontmatter");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 2).trim();
    fm[k] = LIST.has(k) ? v.split(",").map(s => s.trim()).filter(Boolean) : v;
  }
  const blocks = parseBody(m[2]);
  const first = blocks.findIndex(b => b.t === "p");
  const lede = first >= 0 ? blocks.splice(first, 1)[0].text : "";
  const [ct, cb] = (fm.cover || fm.title).split(" | ");
  return {
    slug, title: fm.title, headline: fm.headline || fm.title, description: fm.description,
    date: fm.date, author: fm.author, kicker: fm.kicker || "Article", minutes: Number(fm.minutes) || 4,
    cover: [ct, cb || ""], terms: fm.terms || [], sources: fm.sources || [], lede, blocks, body: m[2],
  };
}

export function parseBody(md) {
  const blocks = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.startsWith("```")) {
      const kind = l.slice(3).trim() || "example";
      const body = [];
      while (++i < lines.length && !lines[i].startsWith("```")) body.push(lines[i]);
      blocks.push({ t: kind, lines: body });
      continue;
    }
    let h = l.match(/^(#{2,3}) (.+)$/);
    if (h) { blocks.push({ t: h[1].length === 2 ? "h2" : "h3", text: h[2].trim() }); continue; }
    h = l.match(/^::quote (\d+)$/);
    if (h) { blocks.push({ t: "quote", i: Number(h[1]) }); continue; }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d/.test(l), items = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, "").trim());
      i--;
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    const para = [l.trim()];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#{2,3} |```|::|- |\d+\. )/.test(lines[i + 1])) para.push(lines[++i].trim());
    blocks.push({ t: "p", text: para.join(" ") });
  }
  return blocks;
}

// Inline markdown as tokens: ["t", text], ["a", text, href], or ["b" | "em",
// tokens] (bold and italic may hold a link). The page turns these into
// elements; the prerender and the guard read the same tokens.
export function inline(s) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(["t", s.slice(last, m.index)]);
    if (m[1] != null) out.push(["b", inline(m[1])]);
    else if (m[2] != null) out.push(["em", inline(m[2])]);
    else out.push(["a", m[3], m[4]]);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(["t", s.slice(last)]);
  return out;
}

export const ARTICLES = Object.entries(RAW)
  .map(([f, raw]) => parseArticle(f.replace(/^\.\/|\.md$/g, ""), raw))
  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.slug.localeCompare(b.slug));
export const ARTICLE = Object.fromEntries(ARTICLES.map(a => [a.slug, a]));
export const ARTICLE_SLUGS = ARTICLES.map(a => a.slug);

// Every internal link in a body, for the link guard.
function linksIn(toks) {
  return toks.flatMap(t => t[0] === "a" ? [t[2]] : Array.isArray(t[1]) ? linksIn(t[1]) : []);
}
export const articleLinks = a => [a.lede, ...a.blocks.flatMap(b => b.text ? [b.text] : b.items || [])]
  .flatMap(s => linksIn(inline(s)));

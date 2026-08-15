// BUILD-54 §2 — the campaign story is SANITIZED STRUCTURED TEXT: an array of
// typed blocks ({type:'p'|'h2'|'ul', …}), never raw HTML/CSS/JS. This lib is
// the editor's text convention ↔ blocks converter (JSX-free, Node-testable;
// the server independently re-validates every payload via validateStoryBlocks
// — nothing here is authoritative). Editor convention:
//   "## Heading"      → h2 block
//   "- item" lines    → ul block (one per run of consecutive - lines)
//   anything else     → paragraph; blank lines separate blocks.

export function textToStory(text) {
  const chunks = String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  const blocks = [];
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length && lines.every(l => l.startsWith("- "))) {
      blocks.push({ type: "ul", items: lines.map(l => l.slice(2).trim()).filter(Boolean) });
    } else if (chunk.startsWith("## ")) {
      blocks.push({ type: "h2", text: chunk.slice(3).trim() });
    } else {
      blocks.push({ type: "p", text: lines.join(" ") });
    }
  }
  return blocks;
}

export function storyToText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.map(b => {
    if (b.type === "h2") return "## " + (b.text || "");
    if (b.type === "ul") return (b.items || []).map(i => "- " + i).join("\n");
    return b.text || "";
  }).join("\n\n");
}

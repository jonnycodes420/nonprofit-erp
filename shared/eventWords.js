// shared/eventWords.js · FEEL-1. The event's sentence, said the way a person
// says it. Its own module, so Home's first look (the moves deck draws events)
// loads these few lines and not every word table in giftWords.js.
import { plural } from "./countWords.js";

// FEEL-1: the event's "adds up" line, as a person says it. Parts are text and
// {k} tokens (a count the screen draws as a figure that opens its rows);
// eventStoryText joins them with the numbers for the server's sentence.
export function eventStoryParts(s) {
  const n = k => Number((s && s[k]) || 0);
  const came = n("attended"), cameGave = n("cameGave"), cameNot = n("cameDidntGive"), gaveNotCame = n("gaveNotCame");
  if (!came && !n("gave")) return null;
  const out = [];
  if (came) {
    out.push({ k: "attended" }, " came");
    if (!cameGave) out.push(", and nobody gave yet.");
    else if (!cameNot) out.push(cameGave === 1 && came === 1 ? ", and gave." : ", and every one of them gave.");
    else out.push(", and ", { k: "cameGave" }, ` of them gave; `, { k: "cameDidntGive" }, ` ${plural(cameNot, "hasn't", "haven't")} yet.`);
    if (gaveNotCame) out.push(" ", { k: "gaveNotCame" }, ` ${plural(gaveNotCame, "other", "others")} gave or pledged without coming.`);
  } else {
    out.push({ k: "gave" }, " gave or pledged, and nobody is marked as having come yet.");
  }
  return out;
}
export function eventStoryText(s) {
  const parts = eventStoryParts(s);
  if (!parts) return null;
  return parts.map(p => (typeof p === "string" ? p : Number((s && s[p.k]) || 0).toLocaleString("en-US"))).join("");
}

// POLISH-5 · AN IMPACT METRIC IS SHOWN AS A SENTENCE, NOT A TEMPLATE. The
// Settings list printed the raw outcome template ("Your ${amount} has covered
// {n} …"). It now reads as it would for a donor who gave exactly the
// threshold once. JSX-free so a suite can import it.
export function impactExample(template, thresholdDollars) {
  const amt = Math.round(Number(thresholdDollars) || 0);
  const dollars = "$" + amt.toLocaleString("en-US");
  return String(template || "")
    .replace(/\$?\{\{?\s*amount\s*\}?\}/gi, dollars)
    .replace(/\{\{?\s*n\s*\}?\}/gi, "1")
    .replace(/\s+/g, " ").trim();
}

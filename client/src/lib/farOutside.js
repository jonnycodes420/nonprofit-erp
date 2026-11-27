// IMPORT-11 · A GIFT FAR OUTSIDE THE PATTERN ASKS FIRST. The server's question
// (shared/numbers/giftOutlier.js, a 409 far_outside) in its own words; "Record
// it" sends the same gift again with confirmFarOutside, "Go back" saves nothing.
export const isFarOutside = e => !!e && (e.code === "far_outside" || (e.body && e.body.code === "far_outside"));
export async function askFarOutside(askConfirm, e) {
  const q = (e && e.body) || e || {};
  return !!(await askConfirm({ title: "Is this amount right?", body: q.sentence, yes: "Record it", no: "Go back" }));
}

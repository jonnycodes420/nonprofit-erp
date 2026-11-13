// FLOWS-10 item 16 (Area 5 Check 17) · THE DEMO'S EIN. Harborlight was seeded with the
// 00-0000000 placeholder, so the receipts check could never pass on the demo. This is a made-up
// number in valid form that isPlaceholderEin (shared/placeholderCopy.js) accepts. It belongs to the
// demo org only: scripts/ci/seed-demo.js writes it, and scripts/ops/flows10-demo-ein.js puts it
// on staging's Harborlight. No real organization is ever given it.
export const DEMO_EIN = "86-3917452";

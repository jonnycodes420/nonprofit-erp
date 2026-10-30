// SWEEP-5 · ONE BOOKKEEPER CELL, FROM ITS OWN CENTS.
//
// The server hands each bookkeeper row its money three times as integer
// cents: `cents` (the gift), `feeCents` (what the processor took) and
// `netCents` (what reached the bank). The screen used `cents` for every money
// column, so a $400 gift showed a $400 fee and a $400 net, and the footers
// added the gross up three times. Each column reads its own cents now; a
// column the server sends no cents for reads its own dollars.
const CENTS_KEY = { amount: "cents", fee: "feeCents", net: "netCents" };

export function bookkeeperCell(col, row) {
  const ck = CENTS_KEY[col.key] || `${col.key}Cents`;
  const c = Number(row[ck]);
  if (row[ck] != null && Number.isFinite(c)) return c / 100;
  return row[col.key];
}

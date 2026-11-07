// TIDY-1 · ONE KEY PER "ALSO" LINE ON A HOME MOVE CARD.
// A household with two pledges folds two pledge moves into one card: two
// lines of one kind. Each pledge line is keyed by its pledge id (MONEY-3 put
// it on the line); any other line by its kind and place.
export function alsoKey(a, i) {
  return a && a.pledgeId ? `${a.kind}:${a.pledgeId}` : `${(a && a.kind) || "also"}:${i}`;
}

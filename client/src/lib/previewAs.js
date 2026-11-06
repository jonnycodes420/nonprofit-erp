// client/src/lib/previewAs.js · GIFTS-2. WHO A PREVIEW IS DRAWN FOR, said once
// for both email editors. JSX-free so the Node suite imports it.
//
//   undefined  nobody picked: the campaign's first recipient (or, with no
//              audience yet, the server's default person)
//   null       "Preview as yourself": the person signed in, sent as "me"
//   { id }     one of her people
//
// The campaign editor sent `(as && as.id) || firstId`, so "Preview as
// yourself" (null) fell through to the first recipient and the preview never
// changed (Muse, 6 Nov).
export function previewAsParam(as, firstId) {
  if (as === null) return "me";
  if (as && as.id) return as.id;
  return firstId || undefined;
}

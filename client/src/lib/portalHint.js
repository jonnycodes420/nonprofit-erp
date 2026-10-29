// FIX-57 · IS A DONOR SIGNED IN HERE? The portal session is an HttpOnly cookie
// the page cannot read, so the server sets a second cookie beside it,
// `steward_portal_in=1`, that holds no secret and opens nothing. The giving
// and membership pages ask give-default only when it is present, so an
// anonymous visit makes no request that can only answer 401.
export function maybeSignedIn() {
  try { return /(?:^|;\s*)steward_portal_in=1(?:;|$)/.test(document.cookie || ""); }
  catch { return false; }
}

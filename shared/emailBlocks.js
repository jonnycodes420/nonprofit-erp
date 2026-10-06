// shared/emailBlocks.js · EMAIL-1. AN EMAIL FROM THE SAME BLOCKS AS A PAGE.
//
// Pure: no DB, no network, no clock. The server and the browser render the
// same HTML from the same blocks.
//
// THE CONTRACT (filled in by the renderer part of the build):
//   renderEmail({ blocks, brand, fields, preheader, subject, links, mode })
//     blocks   widget blocks whose type is in typesForSurface("email")
//     brand    { band, bandFg, accent, accentFg, buttonColor, typePairing, logoUrl, displayName }
//              from the org's one brand (portal_settings), read at render time
//     fields   { first_name, last_gift_amount, last_gift_date, campaign, give_link, org_name, ... }
//     links    { assetBase, videoPage(provider, videoId) -> url, event(id) -> {name,date,url}, givingPage(id) -> {title,url,image} }
//     mode     "send" | "preview"
//   returns { html, text, images: [{ src, alt }], problems: [string] }
//   The footer (address and unsubscribe) is a placeholder the send path fills
//   with unsubscribeEmailFooterHtml; it is always present, whatever the blocks.
export const FOOTER_SLOT = "<!--steward:footer-->";
export function renderEmail() { throw new Error("renderEmail is not built yet"); }

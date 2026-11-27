// HONEST-2 item 2 (W-1126-Integrations-05). THE SITE'S CONNECTIONS LIST IS THE APP'S.
//
// This file used to be a hand-typed table (LANDING-3), "checked against production" once and stale
// since: Square and Mailchimp read "Live" where Settings said "not available yet", and Cash App,
// Venmo and Toast, which Settings brings in as files, were missing. The list is now the server's
// (GET /public/connections, server/connections/publicList.js), built from the registries Settings
// reads, in Settings' three groups. The Connections page (pages/product.jsx) fetches it.
// HONEST-3 item 3: the site lists what connects and what is imported from a file; nothing unavailable.
export const GROUP_ORDER = ["connects", "files"];

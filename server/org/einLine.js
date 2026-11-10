// server/org/einLine.js · MONEY-4 (W-1109-Fundraising-35X). THE EIN LIVES IN ONE PLACE.
// The public form's footer said EIN 84-2917365 while the Year-end editor and
// the receipts said 82-4331907: the footer read its own free-text copy
// (portal_settings.ein_line, typed in the giving page editor) and everything
// else read orgs.ein (Settings, Tax Receipts). The footer now reads orgs.ein
// too, through this line, and the editor's EIN field is gone. A placeholder
// EIN (shared/placeholderCopy.js) is never shown.
"use strict";
const { publicEin } = require("../../shared/placeholderCopy.js");
const einLineOf = ein => { const e = publicEin(ein); return e ? `Tax ID (EIN): ${e}` : null; };
module.exports = { einLineOf };

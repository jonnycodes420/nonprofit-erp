// server/imports/undoReceipts.js · SENDS-3 item 5. IMPORT UNDO ASKS ABOUT RECEIPTS.
//
// TRASH-1: "Import undo's \"remove them too\" (bulk-delete with importId) still
// moves people with live receipts without asking." A person delete asks
// "N receipts were issued to Ana. Void them?" (409 receipts_live, void on
// yes). Both import-undo doors that move people to the trash now ask the same
// question once for the batch: "Remove them too" after the undo (POST
// /donors/bulk-delete, which asks for every batch now), and the confirm's
// "Move them to the trash too" (POST /imports/:id/reverse with alsoMove).
// Read only; the void happens in the trash's own transaction (personTrash).
"use strict";

const PL = require("../donors/personLinks");

// The people the confirm's "Move them to the trash too" would move, and the
// live receipts they hold, with the question in the words the confirm shows.
async function moveReceipts(query, orgId, imp) {
  const sj = imp && imp.summary_json ? (typeof imp.summary_json === "string" ? JSON.parse(imp.summary_json) : imp.summary_json) : {};
  const ids = (await require("./undoPeople").peopleWithActivity(query, orgId, imp, sj.restoredFromTrash || []))
    .filter(p => p.movable).map(p => p.id);
  const held = await PL.receiptHolders(query, orgId, ids);
  return { ...held, total: ids.length, receiptQuestion: PL.batchReceiptQuestion(held.people, held.receipts, ids.length) };
}

module.exports = { moveReceipts };

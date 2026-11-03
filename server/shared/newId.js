// server/shared/newId.js — IDS-1: the one way server code makes a new row id.
//
// Why: ids were "prefix_" + 8–12 hex of a UUID; primary keys span every org, so at
// ~77,000 rows an 8-hex table has even odds of a duplicate-key error. 80 bits never will.
//
// newId("th") → "th_" + 20 lowercase hex (80 random bits from crypto.randomBytes).
// Existing rows keep their shorter ids; every id-shape check accepts both lengths.
// randomHex(n) is for a random suffix that is not a row id (a slug, a batch key).

const crypto = require("crypto");

const ID_HEX = 20;

function randomHex(chars) {
  return crypto.randomBytes(Math.ceil(chars / 2)).toString("hex").slice(0, chars);
}

function newId(prefix, sep = "_") {
  return prefix + sep + randomHex(ID_HEX);
}

module.exports = { newId, randomHex, ID_HEX };

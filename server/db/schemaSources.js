// SPLIT-2: the text the schema version is a hash of. Before the split it was
// db.js alone; the DDL now lives in server/db/, so it is db.js and every file
// below server/db/, in a fixed order. An edit to any of them runs the init once.
const fs = require("fs");
const path = require("path");

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(e => e.isDirectory() ? filesUnder(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
}

module.exports = () => [path.join(__dirname, "..", "..", "db.js"), ...filesUnder(__dirname)]
  .map(f => fs.readFileSync(f, "utf8")).join("\n");

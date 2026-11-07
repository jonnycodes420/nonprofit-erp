// LEAD-IMPORT-1 · "Import a walk report" on /ops (super-admins only).
//
//   POST /ops/imports/preview   { fileName, text }  what the file would add, verify
//                               or reopen, and every line it could not read.
//                               Writes nothing.
//   POST /ops/imports           { fileName, text }  the confirm: one ops_imports row,
//                               stamped with who uploaded it. The same file again
//                               writes nothing and answers { unchanged: true }.
//
// Behind GET /ops's door: 404 to anyone who is not a live super-admin. The
// file is a walk report or the QA fleet lead's summary; it names checks of the
// demo, never a customer's data.
"use strict";
const crypto = require("crypto");
const BOARD = require("./board");
const IMPORTS = require("./opsImports");

function mount(app, { query, run, wrap, opsOnly, opsLimiter }) {
  setImmediate(() => IMPORTS.ensureTable(run).catch(e => console.warn(`[ops] ops_imports could not be made yet: ${e.message}`)));

  const read = async req => {
    const b = req.body || {};
    let base;
    try { base = BOARD.readBoard(); } catch (e) { return { status: 500, body: { error: "board", message: `The board file could not be read: ${e.message}` } }; }
    const imports = await IMPORTS.readImports(query);
    const p = IMPORTS.preview(base, imports, { text: b.text, fileName: b.fileName });
    return p.error ? { status: 400, body: p } : { status: 200, body: p, imports };
  };

  app.post("/ops/imports/preview", opsLimiter, opsOnly, wrap(async (req, res) => {
    const r = await read(req);
    res.status(r.status).json(r.body);
  }));

  app.post("/ops/imports", opsLimiter, opsOnly, wrap(async (req, res) => {
    const r = await read(req);
    if (r.status !== 200) return res.status(r.status).json(r.body);
    const p = r.body;
    if (p.duplicate) return res.json({ unchanged: true, ...p });
    await IMPORTS.ensureTable(run);
    const id = "opi_" + crypto.randomBytes(9).toString("hex");
    const name = String(req.user.name || req.user.email || "super-admin").slice(0, 120);
    // ON CONFLICT: two confirms of one file at once still make one row.
    await run(`INSERT INTO ops_imports (id, shape, report_date, file_name, sha256, body, created_at, created_by, created_by_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING`,
      [id, p.shape, p.date, p.file, p.sha, String(req.body.text), new Date().toISOString(), req.user.userId, name]);
    if (req.audit) { req.audit.entity("ops_import", id, p.file); req.audit.label(`/ops import ${p.file}`); }
    res.status(201).json({ id, ...p });
  }));
}

module.exports = { mount };

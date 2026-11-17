// server/admin/sales/prospectAdd.js · SALES-4 items 4 and 5. PICKED ROWS BECOME PROSPECTS.
//
// add(ctx, { list: { id } | { name }, rows }, who) makes one sales organization per picked row and
// puts it on the named prospect list. Each keeps its EIN, its ProPublica link (source_url), its
// address and ZIP, its revenue and NTEE code, and the 990's phone when the row has one (a CSV may;
// the API never does). Officers a CSV names become the organization's ED and DD contacts.
//
// DE-DUPLICATION, before anything is written: a row whose EIN is already a live sales
// organization's, or (no EIN match) whose name and city are, is not made again. That organization
// goes on the list instead, and the answer says which one and why. Two picked rows that are the
// same organization make one. Fit is SALES-2's rule, computed on read (never stored).
//
// THE PLANTED DEFECT (SALES4_PLANT=dupe on the server, tests only): the EIN and name checks are
// skipped, so adding the same ProPublica result twice makes two organizations. §5 goes red.
"use strict";
const REC = require("./records");
const LINKS = require("./links");
const PL = require("./prospectLists");
const PP = require("./propublica");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES4_PLANT || "" : "";
const MAX_ROWS = 500;

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { first_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0], last_name: parts.length > 1 ? parts[parts.length - 1] : "" };
}

async function add(ctx, b, who) {
  const rows = (Array.isArray(b && b.rows) ? b.rows : []).slice(0, MAX_ROWS)
    .map(r => ({ ...r, ein: PP.einOf(r.ein), name: String(r.name || "").trim().slice(0, 300) })).filter(r => r.name);
  if (!rows.length) return { error: "invalid", message: "Pick at least one organization." };
  const list = await PL.listFor(ctx, b.list || null, who);
  if (!list) return { error: "invalid", message: "Name the prospect list these go on." };
  if (list.error) return list;
  const hits = PLANT === "dupe" ? rows.map(() => null) : await PP.existing(ctx.query, rows);
  const made = [], already = [], seen = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = r.ein || PP.nameKey(r.name, r.city);
    if (PLANT !== "dupe" && seen.has(key)) { already.push({ name: r.name, id: seen.get(key), why: "picked twice" }); continue; }
    if (hits[i]) {
      await PL.addMember(ctx, list.id, hits[i].id, who);
      already.push({ name: r.name, id: hits[i].id, existing: hits[i].name, why: hits[i].by === "ein" ? `already here by EIN (${hits[i].name})` : `already here by name and city (${hits[i].name})` });
      seen.set(key, hits[i].id);
      continue;
    }
    const o = await REC.create(ctx, "org", { name: r.name, city: r.city || "", state: r.state || "", address: r.address || "", ein: r.ein || "",
      revenue: r.revenue != null ? r.revenue : "", phone: r.phone || "", nonprofit_type: r.ntee || "" }, who, { force: true });
    if (o.error) return o;
    await ctx.run(`UPDATE sales_orgs SET source_url = ?, zip = ? WHERE id = ?`, [r.sourceUrl || (r.ein ? PP.ORG_PAGE(r.ein) : null), r.zip || null, o.id]);
    for (const off of Array.isArray(r.officers) ? r.officers.slice(0, 4) : []) {
      const n = splitName(off.name);
      if (!n) continue;
      const c = await REC.create(ctx, "contact", { ...n, title: off.title || "", role: off.role || "" }, who, { force: true });
      if (!c.error) await LINKS.associate(ctx, "contact", c.id, "org", o.id, { primary: true }, who);
    }
    await PL.addMember(ctx, list.id, o.id, who);
    made.push({ id: o.id, name: r.name });
    seen.set(key, o.id);
  }
  const says = [`${made.length} added to ${list.name}.`, already.length ? `${already.length} already in Sales, put on the list instead: ${already.map(a => `${a.name} (${a.why})`).join("; ")}.` : ""].filter(Boolean).join(" ");
  return { ok: true, listId: list.id, listName: list.name, added: made, already, says };
}

// "Find contact": a Google search for the ED's name with the organization's name (a link only).
function findContactUrl(org, ed) {
  const who = ed ? [ed.first_name, ed.last_name].filter(Boolean).join(" ") : "executive director";
  const q = `"${who}" "${org.name}"${org.city ? ` ${org.city}` : ""}${org.state ? ` ${org.state}` : ""}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

module.exports = { add, findContactUrl, splitName, MAX_ROWS, PLANT };

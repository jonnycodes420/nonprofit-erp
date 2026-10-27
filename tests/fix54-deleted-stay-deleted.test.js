// tests/fix54-deleted-stay-deleted.test.js: FIX-54. SOMEONE YOU DELETED STAYS
// DELETED. The build's one new test (it guards donor data: a customer who
// deletes someone must never see them again unless she brings them back).
//
// 27 Oct, prod: an org deleted its ~1,200 sample people from the Donors page,
// imported a gifts file of ~200 other people, and saw the sample people back
// in the Donors list. The Donors page had no Delete for "Select all N
// matching" (only a page at a time), the bulk delete's Undo stayed up over the
// next screen, and an import naming someone deleted made them again as new.
//
//   §1 Select all N matching, Delete: exactly N go, and a confirm for a
//      different N than the selection holds deletes nobody.
//   §2 300 deleted, 200 different people imported: the Donors list says 200,
//      and Home, onboarding, groups, search, Ask and the export agree.
//   §3 a deleted person in the next file: the preview names them under
//      "match someone you deleted", nothing is made for them, their rows are
//      set aside; Bring them back is the one way they return, and only then
//      are their rows imported, onto them.
//   §4 import, delete some of its people (and one who was already here) by
//      hand, undo the import: the hand-deleted stay deleted.
//
// HOW IT GOES RED ON MAIN: the bulk delete ignores the confirmed count (§1),
// and the import makes the deleted person again as someone new, with no
// deletedMatches in the preview and no /sheet-import/bring-back (§3).
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");   // HARDEN-1
async function surfacesAgree(label, orgId, token) {
  const r = await assertSurfacesAgree(orgId, { token, soft: true, label });
  ok(`every surface agrees ${label} (${r.ms}ms)`, r.ok, r.diffs.length);
  for (const d of r.diffs) console.log("        " + d);
}


const PASSWORD = "loadtest1234";
const ORG = "org_fix54a";
const TABLES = ["audience_members", "audiences", "deleted_records", "interactions", "gifts", "imports", "sheet_import_jobs", "donor_scores",
  "thank_you_drafts", "tasks", "fin_transactions", "donors", "households", "fin_funds", "accounts", "budgets", "users"];
const one = async (sql, args) => (await q(sql, args))[0];

async function freshOrg(id, name) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
async function sheetImport(tok, grid, fileName) {
  const body = { fileName, sheets: [{ name: "Sheet1", grid }] };
  const u = await api("POST", "/sheet-import/understand", tok, body);
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  let end = null;
  for (let i = 0; i < 400 && c.status === 202; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(c.body.importId)}`, tok);
    if (j.body.status !== "running") { end = j.body; break; }
    await new Promise(r => setTimeout(r, 150));
  }
  return { u, c, end, importId: c.body && c.body.importId };
}
const giftsGrid = (rows) => [["Date", "Donor", "Amount", "Memo", "Category"], ...rows];
const listTotal = async tok => (await api("GET", "/donors?role=donor&limit=25&offset=0", tok)).body.total;

async function main() {
  const tok = await freshOrg(ORG, "Steward LLC (test)");
  // 300 sample people with a gift each, the way the demo file wrote them
  const donors = [], gifts = [];
  for (let i = 0; i < 300; i++) {
    donors.push({ name: i % 10 === 0 ? `Hope Assembly of God ${i}` : `Sample Person ${i}`, email: `demo${String(i).padStart(4, "0")}@example.org`, tags: ["demo-file"] });
    gifts.push({ donorIndex: i, amount: 50 + i, date: "2026-0" + (1 + (i % 8)) + "-15" });
  }
  const seed = await api("POST", "/donors/import-combined", tok, { donors, gifts });
  ok("setup: 300 sample people with gifts", seed.status === 200 && (await listTotal(tok)) === 300, seed.status + " " + JSON.stringify(seed.body).slice(0, 200));
  await surfacesAgree("after the first import", ORG, tok);
  const grp = await api("POST", "/groups", tok, { name: "Everyone kept", kind: "static" });
  const sampleIds = (await q("SELECT id FROM donors WHERE org_id=$1", [ORG])).map(r => r.id);
  await api("POST", `/groups/${grp.body.id}/members`, tok, { donorIds: sampleIds });

  // §1 Select all N matching, Delete
  const all = await api("GET", "/donors/ids?role=donor", tok);
  const ids = all.body.ids || [];
  ok("§1 Select all N matching gathers all 300", ids.length === 300, ids.length);
  const wrong = await api("POST", "/donors/bulk-delete", tok, { ids: ids.slice(0, 299), count: 300 });
  ok("§1 a confirm for 300 against a selection of 299 deletes nobody", wrong.status === 409 && (await listTotal(tok)) === 300,
     wrong.status + " " + JSON.stringify(wrong.body).slice(0, 200));
  const del = await api("POST", "/donors/bulk-delete", tok, { ids, count: ids.length });
  ok("§1 Delete with all 300 selected deletes exactly 300", del.status === 200 && del.body.deleted === 300 && (del.body.undoIds || []).length === 300,
     del.status + " " + JSON.stringify(del.body).slice(0, 200));
  ok("§1 the Donors list shows nobody", (await listTotal(tok)) === 0, await listTotal(tok));
  await surfacesAgree("after the bulk delete of everyone", ORG, tok);

  // §2 a gifts file of 200 different people
  const rows = [];
  for (let i = 0; i < 280; i++) rows.push([`2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, `Quillon Newfamily${i % 200}`, String(25 + i), "Thanks", "Annual fund"]);
  const imp = await sheetImport(tok, giftsGrid(rows), "gifts-200.csv");
  ok("§2 the preview says 200 new, nobody deleted matched", imp.u.body.newPeople === 200 && !(imp.u.body.deletedMatches || []).length, JSON.stringify([imp.u.body.newPeople, imp.u.body.deletedMatches]).slice(0, 200));
  ok("§2 the import finishes", imp.end && imp.end.status === "done", JSON.stringify(imp.end).slice(0, 200));
  await surfacesAgree("after the import of 200 others", ORG, tok);
  const alive = (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL", [ORG])).n;
  const stillGone = (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NOT NULL", [ORG, sampleIds])).n;
  ok("§2 the 300 deleted are still deleted, and 200 are here", alive === 200 && stillGone === 300, { alive, stillGone });
  ok("§2 the Donors list says 200", (await listTotal(tok)) === 200, await listTotal(tok));
  const setup = (await api("GET", "/org/setup-status", tok)).body || {};
  const dItem = (setup.items || []).find(i => i.key === "donors") || {};
  ok("§2 onboarding counts the 200", dItem.count === 200, dItem);
  const home = JSON.stringify((await api("GET", "/dashboard/home", tok)).body || {});
  ok("§2 Home names no deleted person", !/Sample Person|Hope Assembly|demo0\d+@example\.org/.test(home), home.slice(0, 300));
  const groups = (await api("GET", "/groups", tok)).body.groups || [];
  ok("§2 the group of the 300 now holds nobody", (groups.find(g => g.id === grp.body.id) || {}).count === 0, groups.map(g => [g.name, g.count]));
  const srch = JSON.stringify(((await api("GET", "/search?q=Sample%20Person%2017", tok)).body || {}).results || null);
  ok("§2 search finds no deleted person", !/Sample Person 17/.test(srch), srch.slice(0, 300));
  const ask = await api("POST", "/ask", tok, { question: "How many donors do we have?" });
  ok("§2 Ask counts no deleted person", ask.status !== 200 || !/\b500\b|\b300\b/.test(JSON.stringify(ask.body)), JSON.stringify(ask.body).slice(0, 300));
  const csv = await fetch(`${process.env.BASE || "http://localhost:5601"}/donors/export/csv?role=donor`, { headers: { Authorization: "Bearer " + tok } }).then(r => r.text());
  const csvRows = csv.trim().split(/\r?\n/).length - 1;
  ok("§2 the export has the 200 and none of the deleted", csvRows === 200 && !/example\.org/.test(csv), csvRows);

  // §3 a deleted person in the next file: by name, and by email
  const [p17] = await q("SELECT id, name FROM donors WHERE org_id=$1 AND email='demo0017@example.org'", [ORG]);
  const [p20] = await q("SELECT id, name FROM donors WHERE org_id=$1 AND email='demo0020@example.org'", [ORG]);
  const grid3 = [["Date", "Donor", "Email", "Amount"], ["2026-10-01", p17.name, "", "40"], ["2026-10-02", "Someone Else Entirely", "demo0020@example.org", "60"], ["2026-10-03", "Brand Newperson", "", "75"]];
  const body3 = { fileName: "next.csv", sheets: [{ name: "Sheet1", grid: grid3 }] };
  const u3 = (await api("POST", "/sheet-import/understand", tok, body3)).body || {};
  const dm = u3.deletedMatches || [];
  ok("§3 the preview names both under \"match someone you deleted\"", dm.length === 2 && dm.some(x => x.id === p17.id) && dm.some(x => x.id === p20.id)
     && /^2 people match someone you deleted\. Not imported\.$/.test(u3.deletedSentence || ""), JSON.stringify([dm, u3.deletedSentence]));
  ok("§3 only the one new person is new", u3.newPeople === 1, u3.newPeople);
  const run3 = await sheetImport(tok, grid3.map(r => r.slice()), "next.csv");
  const rc3 = (run3.end && run3.end.result) || {};
  ok("§3 the import makes nothing for them: one new person, one gift", rc3.donorsCreated === 1 && rc3.giftsCreated === 1, JSON.stringify(rc3).slice(0, 300));
  await surfacesAgree("after an import naming the deleted", ORG, tok);
  const twins = (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND (LOWER(name)=LOWER($2) OR LOWER(email)='demo0020@example.org')", [ORG, p17.name])).n;
  ok("§3 they stay deleted, and no copy of them is here", twins === 0
     && (await one("SELECT COUNT(*)::int AS n FROM donors WHERE id = ANY($1) AND deleted_at IS NOT NULL", [[p17.id, p20.id]])).n === 2, twins);
  const rec3 = ((await api("GET", `/imports/${run3.importId}`, tok)).body || {}).import || {};
  ok("§3 their two rows are set aside and the receipt reconciles", rec3.rowsSetAside === 2 && rec3.reconciled === true, JSON.stringify([rec3.rowsSetAside, rec3.reconciled, rec3.findings]).slice(0, 300));
  const bb = await api("POST", "/sheet-import/bring-back", tok, { ids: [p17.id] });
  ok("§3 Bring them back returns exactly the person she pressed it for", bb.status === 200 && bb.body.restored === 1
     && (await one("SELECT deleted_at FROM donors WHERE id=$1", [p17.id])).deleted_at === null
     && (await one("SELECT deleted_at FROM donors WHERE id=$1", [p20.id])).deleted_at !== null, bb.status + " " + JSON.stringify(bb.body));
  await surfacesAgree("after Bring them back", ORG, tok);
  const u3b = (await api("POST", "/sheet-import/understand", tok, body3)).body || {};
  ok("§3 once back, the file matches them", (u3b.people || []).some(p => p.members.some(m => m.id === p17.id && m.status === "matched")) && (u3b.deletedMatches || []).length === 1,
     JSON.stringify([u3b.matchedPeople, u3b.deletedMatches]).slice(0, 300));

  // §4 import, delete by hand, undo the import
  await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,person_types,created_by,created_by_name) VALUES ('d_f54_here',$1,'Marigold Alreadyhere','steward','active','[]','["donor"]','system:test','test')`, [ORG]);
  const here = { id: "d_f54_here", name: "Marigold Alreadyhere" };
  const grid4 = giftsGrid([["2026-10-05", here.name, "10", "", ""], ["2026-10-05", "Ottoline Fresh", "11", "", ""], ["2026-10-05", "Peregrine Fresh", "12", "", ""]]);
  const run4 = await sheetImport(tok, grid4, "four.csv");
  const made4 = (await q("SELECT id FROM donors WHERE org_id=$1 AND created_import_id=$2", [ORG, run4.importId])).map(r => r.id);
  ok("§4 the import made two and matched one already here", made4.length === 2 && run4.end && run4.end.status === "done", [made4, run4.u.body.questions]);
  const d4 = await api("POST", "/donors/bulk-delete", tok, { ids: [made4[0], here.id], count: 2 });
  ok("§4 two deleted by hand (one the file made, one already here)", d4.status === 200 && d4.body.deleted === 2, d4.status);
  await surfacesAgree("after deleting two by hand", ORG, tok);
  const un = await api("POST", `/imports/${run4.importId}/reverse`, tok, {});
  ok("§4 the undo runs", un.status === 200, un.status + " " + JSON.stringify(un.body).slice(0, 200));
  const back4 = await q("SELECT id FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NULL", [ORG, [made4[0], here.id]]);
  ok("§4 the hand-deleted stay deleted after the undo", back4.length === 0, back4);
  await surfacesAgree("after the import undo", ORG, tok);
  ok("§4 the Donors list holds no one the undo should not bring back", (await listTotal(tok)) === 202,
     await listTotal(tok));   // the 200, Brand Newperson, and the one person she brought back
}

main().then(async () => { await closeDb(); summary(); }).catch(async e => { console.error(e); await closeDb(); process.exit(1); });

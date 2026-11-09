// server/donors/addPerson.js · FLOWS-3 (W-1108-Volunteers-20). ADDING A
// PERSON BY HAND, ONE WAY.
//
// This is the body of POST /donors (+ Add), moved here unchanged so a second
// door can use it: a guest typed onto an event with no record on file used
// to be a name on the guest list and nowhere else (search could not find
// them, Everyone did not move). Now that door adds them here, typed "guest",
// with the same checks: a real name, a real email, the plan's record limit,
// an owner from this org, the actor stamp, and the duplicate-email warning.
//
// Answers { status, body } for the route to send.
"use strict";
const ItemRefs = require("../../itemRefs");   // THREAD-2: the things a sentence names
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

async function addPerson(ctx, req, b) {
  const { OU, PT_READY, actor, checkPlanLimit, keepImportedTotals, markDonorsForGeocoding, query, run } = ctx;
  const PT = await PT_READY;
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../../contactInputs").checkContact(b, { email: ["email", "email2"], phone: ["phone"] });
    if (cv.error) return { status: 400, body: { error: cv.error, message: cv.error, field: cv.field } };
    Object.assign(b, cv.values); }
  const { email, phone, status, stage, tags, notes, lastAmount, assignedTo, assignedToName, personTypes } = b;
  // ADDRESS-1: the + Add form carries the mailing address too.
  const addr = Object.fromEntries(["address", "address2", "city", "state", "zip"].map(f =>
    [f, b[f] == null ? null : (String(b[f]).trim().slice(0, f === "address" || f === "address2" ? 200 : 120) || null)]));
  // THREAD-2 · A NAME IS A NAME. "   " and the word "null" (a form that joined
  // two empty fields) were saved as names, and printed on the Thread and in
  // the morning email as a blank or as "null". Refused here, at the source.
  if (!(await ItemRefs.links()).realName(b.name)) return { status: 400, body: { error: "Name required" } };
  const name = String(b.name).replace(/\s+/g, " ").trim();
  // BUILD-94 Part 2 — a person added by hand can be a volunteer from the
  // start. Unknown keys are dropped by normalizeTypes, never stored.
  const types = personTypes === undefined ? ["donor"] : PT.normalizeTypes(personTypes);

  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999 && recordCheck.current >= recordCheck.limit) {
      return { status: 403, body: { error: "record_limit", message: `You've reached your donor record limit of ${recordCheck.limit}.`, current: recordCheck.current, limit: recordCheck.limit, plan: orgForLimit[0].plan, isTrial: false } };
    }
  }

  // FIX-19: an assignee named here is an active user of this org, and the name
  // beside the id is read off that users row, never the payload.
  const named = await OU.orgUser(req.user.orgId, assignedTo);
  if (!named.ok) return { status: 400, body: { error: "user_not_in_org", field: "assignedTo", message: OU.REFUSED } };

  const id = newId("d");
  let selfName = assignedToName;
  if (!assignedTo && !selfName) {
    const uRow = await query("SELECT name FROM users WHERE id = ?", [req.user.userId]);
    selfName = uRow[0]?.name || req.user.email;
  }
  const finalAssignedTo = assignedTo || req.user.userId;
  const finalAssignedToName = assignedTo ? (named.user.name || assignedToName || "") : selfName;
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes,assigned_to,assigned_to_name,created_by,created_by_name,person_types,address,address2,city,state,zip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    // BUILD-80 Part 10 — the quick form's typed amount carries NO date: a
    // last_gift_date of "today" was a fiction that un-drifted the donor.
    [id, req.user.orgId, name, email || "", phone || "", status || "new", stage || "prospect",
     lastAmount || 0, lastAmount || 0, null, lastAmount ? 1 : 0,
     JSON.stringify(tags || []), notes || "", finalAssignedTo, finalAssignedToName, actor(req).id, actor(req).name,
     JSON.stringify(types), addr.address, addr.address2, addr.city, addr.state, addr.zip]
  );
  if (addr.address || addr.city || addr.zip) {
    try { await markDonorsForGeocoding(req.user.orgId, { donorIds: [id] }); } catch (e) { console.error("[geocode] mark after add failed:", e.message); }
  }
  // NUMBERS-2: a typed amount with no gift behind it is kept as its own figure.
  if (lastAmount) await keepImportedTotals(query, req.user.orgId, [id], "an amount typed in when they were added");
  const rows = await query("SELECT * FROM donors WHERE id = ?", [id]);
  // INTEGRITY-1: an email already on another active person is said on save, never silent
  const warning = await require("../dataHealth/integrity").emailWarning(query, req.user.orgId, rows[0] && rows[0].email, id);
  return { status: 201, body: warning ? { ...rows[0], warning } : rows[0] };
}

module.exports = { addPerson };

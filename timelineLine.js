// WIRE-1 rule 2 · EVERY ACTION LANDS ON THE TIMELINE.
//
// The person's timeline is read from `interactions` (plus gifts, tasks,
// attachments and hours). An act that is not a gift (a free registration, a
// comp membership, a pledge, a plan started, a fundraising page, a grant
// moving) lands there as ONE interactions row written here.
//
// ONE LINE PER ACT. Each caller names the act with a `key` (for example
// `registered:<attendeeId>`); a second call with the same key finds the line
// already there and writes nothing, so a retried webhook or a page submitted
// twice still reads once.
//
// The type: 'event' for an event line (the attendance list already writes
// those), 'activity' for everything else. 'activity' is deliberately NOT a
// conversation type: it never counts as last contact, an active donor or a
// staff touch, because nobody spoke to anybody.
const { query, run, uuid } = require("./db");
const orgTime = require("./orgTime");

async function writeTimelineLine({ orgId, donorId, note, type = "activity", date = null, actorId, actorName = null, key = null, metadata = {} } = {}) {
  if (!orgId || !donorId || !note) return { written: false, reason: "missing" };
  if (key) {
    const [had] = await query(
      "SELECT id FROM interactions WHERE org_id=? AND donor_id=? AND metadata->>'line_key' = ? LIMIT 1",
      [orgId, donorId, String(key)]);
    if (had) return { written: false, id: had.id, reason: "already" };
  }
  let day = date ? String(date).slice(0, 10) : "";
  if (!day) {
    const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]).catch(() => []);
    day = orgTime.orgToday({ timezone: o && o.timezone });   // ORG_TZ_SEAM_OK (the org's civil today)
  }
  // A person names the line by their name, not their sign-in address.
  if (actorId && !String(actorId).startsWith("system:") && (!actorName || String(actorName).includes("@"))) {
    const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [actorId, orgId]).catch(() => []);
    if (u && u.name) actorName = u.name;
  }
  const id = "i_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, orgId, donorId, type, String(note), day, actorId || "system:timeline", actorName,
     JSON.stringify({ ...metadata, ...(key ? { line_key: String(key) } : {}) })]);
  return { written: true, id };
}

// The same, never throwing: a timeline line must not fail the act it records.
async function timelineLine(opts) {
  try { return await writeTimelineLine(opts); }
  catch (e) { console.error("[timeline] line not written:", e.message); return { written: false, reason: "error" }; }
}

// Money in words on a line: "$50" or "$50.25".
function lineMoney(n) {
  const v = Number(n) || 0;
  return "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

// "a month", "a week", "a quarter", "a year" for a plan's interval.
function intervalWords(interval, count = 1) {
  const i = String(interval || "month").toLowerCase().replace(/ly$/, "");
  const word = i === "annual" || i === "year" ? "year" : i === "week" ? "week" : i === "quarter" ? "quarter" : i === "day" ? "day" : "month";
  const c = Number(count) || 1;
  if (word === "month" && c === 3) return "a quarter";
  if (word === "month" && c === 12) return "a year";
  return c > 1 ? `every ${c} ${word}s` : `a ${word}`;
}

module.exports = { writeTimelineLine, timelineLine, lineMoney, intervalWords };

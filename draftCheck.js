// draftCheck.js · FIX-27 Part 7. THE RECORD A DRAFTED MESSAGE IS CHECKED AGAINST.
//
// Every message a model drafts for a donor (a milestone thank-you, a quiet
// check-in, an Agent draft, a campaign or sequence email from Communications)
// goes through shared/suggestionGuard.js guardDraft before a person sees it.
// This reads the record it is checked against: the person's own gifts and
// dates, the video thank-you that is ready for them (and its one link), the
// conversations logged with them, and the organisation's events. A draft for
// a whole segment has no person, so it may claim nothing personal at all.
// Read only; org-scoped like every read.
const { query } = require("./db");
const { publicAppUrl } = require("./publicUrl");

let _g = null;
const guardMod = async () => (_g = _g || await import("./shared/suggestionGuard.js"));

async function draftRecord(orgId, donorId = null) {
  const [org] = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);
  const events = await query("SELECT name FROM events WHERE org_id = ? ORDER BY date DESC NULLS LAST LIMIT 200", [orgId]).catch(() => []);
  const base = { orgName: (org && org.name) || "", events: events.map(e => e.name).filter(Boolean), links: [], meetings: [], video: null, rows: [] };
  if (!donorId) return base;
  const [donor] = await query(
    `SELECT id, name, email, total_giving, gift_count, last_gift_amount, last_gift_date, first_gift_date
       FROM donors WHERE id = ? AND org_id = ?`, [donorId, orgId]);
  if (!donor) return base;
  const [gifts, video, meetings] = await Promise.all([
    query(`SELECT id, amount, date FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0 ORDER BY date DESC LIMIT 200`, [orgId, donorId]),
    query(`SELECT token FROM video_thanks WHERE org_id = ? AND donor_id = ? AND asset_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [orgId, donorId]).catch(() => []),
    query(`SELECT date, type FROM interactions WHERE org_id = ? AND donor_id = ? AND type IN ('meeting','call','visit','event') ORDER BY date DESC LIMIT 50`, [orgId, donorId]).catch(() => []),
  ]);
  return { ...base, donor,
    rows: gifts.map(g => ({ id: g.id, amount: Number(g.amount), date: g.date })),
    video: video[0] ? { ready: true, url: `${publicAppUrl()}/v/${video[0].token}` } : null,
    meetings };
}

// { ok, reasons } for one drafted text against one record.
async function checkDraft(text, record) {
  const G = await guardMod();
  return G.guardDraft(text, record);
}

module.exports = { draftRecord, checkDraft };

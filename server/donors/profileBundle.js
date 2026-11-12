// PROFILE-SPEED-1 · A PROFILE OPENS IN ONE TRIP.
//
//   GET /donors/:id/profile             everything the first screen draws
//   GET /donors/:id/profile?p=<path>…   only those of them (what the browser
//                                        does not already have)
//
// LOAD-1 opened a profile in two requests, and in practice it was three: the
// list read the person's record (GET /donors/:id) the moment a row was
// clicked, and the profile asked for the rest of what shows above the fold
// beside it, so the screen waited on whichever came back last. Under the
// nightly's 20 users the two together held up to 10 of the web's 10
// connections (REPORTS-SPEED-2).
//
// Now the record and everything above the fold come back in one answer. Each
// part is the route's own answer, run inside this process as the person asking
// (routes/homeBundle.js answer(), the same function Home's bundle uses): the
// header's figures come from /donors/:id, the rail from /donors/:id/rail, and
// so on, so no rule or number has a second copy here. The separate routes stay
// for the re-reads after an action. What the profile shows only on a tab (its
// receipts, open asks, planned gifts) is read when that tab opens
// (client/src/lib/profileReads.js).
//
// The request's statements share the request's three connections
// (pools.js PER_REQUEST_MAX), however many parts it has.
"use strict";

// What the first screen draws, in the order the screen needs it. The person's
// record first: the header cannot draw without it.
const FIRST_SCREEN = [
  "/donors/:id",                    // the header, the numbers, the gift list
  "/donors/:id/status", "/donors/:id/scores", "/donors/:id/rail", "/donors/:id/relationship",
  "/donors/:id/plan",               // the Next step
  "/threads?donorId=:id",           // the first page of the timeline's threads
  "/insights/donor/:id", "/donors/:id/before-meeting", "/donors/:id/blocked-mail", "/people/:id",
  "/atlas/notes?place=person&id=:id", "/donors/:id/journeys",
  "/donors/:id/relationships",      // the rail's people
  "/donors/:id/pledges",            // the Giving tab's count (gifts and pledges) and the rail's pledge
  "/donors/:id/custom-fields",      // the rail's facts
  "/donors/:id/attachments", "/donors/:id/materials",   // the Files tab's count (STALE-2)
];
// A panel spells the id as it has it, encoded or not; both name the same read.
const firstScreen = id => FIRST_SCREEN.map(p => p.split(":id").join(encodeURIComponent(id)));
const spellings = id => new Set([...firstScreen(id), ...FIRST_SCREEN.map(p => p.split(":id").join(id))]);

function mount({ app, requireAuth, wrap, answer, query }) {
  app.get("/donors/:id/profile", requireAuth, wrap(async (req, res) => {
    const id = String(req.params.id);
    const all = firstScreen(id);
    const asked = [...new Set([].concat(req.query.p || []).map(String))];
    const ok = spellings(id);
    const refused = asked.filter(p => !ok.has(p));
    if (refused.length) return res.status(400).json({ error: "not_a_profile_read", message: "That read is not part of this profile's first screen.", paths: refused });
    // REDTEAM-1: another org's person is a 404 for the whole answer.
    const [mine] = await query(`SELECT 1 FROM donors WHERE id=? AND org_id=?`, [id, req.user.orgId]);
    if (!mine) return res.status(404).json({ error: "Not found" });
    await answer(req, res, asked.length ? asked : all);
  }));
}

module.exports = { mount, FIRST_SCREEN, firstScreen };

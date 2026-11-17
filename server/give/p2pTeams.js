// server/give/p2pTeams.js · FLOWS-18 item 4 (W-1117-Volunteers-30). A TEAM CARD AND ITS ROWS ARE ONE READ.
//
// Spring Paddle's first load labelled Noor Delacroix ($150, 1 gift) "Dockside Paddlers", so four
// rows said Dockside ($1,145) while the Dockside card said 3 fundraisers and $995. The cards and the
// rows came from two queries in one request; a fundraiser moved between them (the fleet walks
// staging at the same time) gives a row a team its card doesn't count. Now a team's members and
// raised are counted from the SAME fundraiser rows the list shows, and each row's team name is its
// card's; a row whose team is not one of this campaign's cards names none.
"use strict";

// teams: rows of p2p_teams (id, name, …); shaped: GET /giving-pages/:id/p2p's fundraiser rows
// ({ teamId, teamName, status, raisedCents }). Both are changed in place; teams are re-sorted.
function teamsFromRows(teams, shaped) {
  const byId = new Map(teams.map(t => [t.id, t]));
  for (const f of shaped) {
    const t = f.teamId ? byId.get(f.teamId) : null;
    if (!t) { f.teamId = null; f.teamName = null; } else f.teamName = t.name;
  }
  for (const t of teams) {
    const mine = shaped.filter(f => f.teamId === t.id);
    t.members = mine.filter(f => f.status === "active").length;
    t.raised = mine.reduce((a, f) => a + f.raisedCents, 0) / 100;
  }
  teams.sort((a, b) => b.raised - a.raised || String(a.name).localeCompare(String(b.name)));
  return teams;
}

module.exports = { teamsFromRows };

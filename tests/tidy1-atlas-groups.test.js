// tests/tidy1-atlas-groups.test.js · TIDY-1 item 2: Atlas's groups expire.
//
// "Open list" makes a group for each question (ATLAS-3). A group Atlas made is
// marked made_by='atlas', listed apart ("From Atlas"), and goes 30 days after
// it was made unless somebody renamed it, pinned it or used it in a campaign
// (server/groups/atlasExpiry.js). Failed on main: nothing marked a group as
// Atlas's and nothing removed one, so every question left a group for ever.
//
// Its own fixture org, made-up names; nothing sends. The sweep runs in-process
// against the suite's database with the test clock, so no wait for the daily job.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_tidy1g_${RUN}`;
const OWNER = `owner-${RUN}@tidy1g.local`;
const PW = "loadtest1234";
const DAY = 24 * 60 * 60 * 1000;

(async () => {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at)
           VALUES ($1,'Tidy One Garden Club (test)',$1,1,'active','team',false,'America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync(PW, 4), `u_tidy1g_${RUN}`, OWNER]);
  const tok = await login(OWNER, PW);
  const donor = `d_t1g_${RUN}`;
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,'Wren Applethorpe',$3,'system:test','test fixture')`,
    [donor, ORG, `${donor}@tidy1g.invalid`]);

  const now = testNow();
  // An Atlas group, as Open list leaves it: static, with its people, marked.
  async function atlasGroup(name, ageDays) {
    const made = await api("POST", "/groups", tok, { name, kind: "static", description: `The people Atlas found for "${name}".` });
    const id = made.body && made.body.id;
    if (id) await api("POST", `/groups/${id}/members`, tok, { donorIds: [donor] });
    await q(`UPDATE audiences SET made_by='atlas', created_at=$3 WHERE id=$1 AND org_id=$2`,
      [id, ORG, new Date(now - ageDays * DAY).toISOString()]).catch(e => ok(`setup ${name}`, false, e.message));
    return id;
  }
  const old = await atlasGroup("Who gave last December", 31);
  const young = await atlasGroup("Who gave in March", 10);
  const renamed = await atlasGroup("Who lapsed this year", 31);
  const pinned = await atlasGroup("Top givers in 2025", 31);
  const sent = await atlasGroup("Who came to the gala", 31);
  const mine = (await api("POST", "/groups", tok, { name: "Garden volunteers", kind: "static" })).body.id;
  await q(`UPDATE audiences SET created_at=$3 WHERE id=$1 AND org_id=$2`, [mine, ORG, new Date(now - 60 * DAY).toISOString()]);
  ok("setup: five Atlas groups and one of hers", [old, young, renamed, pinned, sent, mine].every(Boolean));

  const r1 = await api("PATCH", `/groups/${renamed}`, tok, { name: "Lapsed: call in spring" });
  ok("renaming an Atlas group is recorded", r1.status === 200 && r1.body && r1.body.renamed === true, r1.status + " " + JSON.stringify(r1.body).slice(0, 160));
  const r2 = await api("POST", `/groups/${pinned}/pin`, tok, { pinned: true });
  ok("pinning an Atlas group is recorded", r2.status === 200 && r2.body && r2.body.pinned === true, r2.status);
  await q(`INSERT INTO campaigns (id,org_id,name,status,segment) VALUES ($1,$2,'Gala thank-you','draft',$3)`,
    [`camp_t1g_${RUN}`, ORG, JSON.stringify({ mode: "audience", audienceId: sent })]);

  // The list keeps Atlas's groups apart.
  const list = (await api("GET", "/groups", tok)).body || {};
  const byId = Object.fromEntries((list.groups || []).map(g => [g.id, g]));
  ok("GET /groups marks Atlas's groups, and not hers", byId[old] && byId[old].fromAtlas === true && byId[mine] && byId[mine].fromAtlas === false,
    { old: byId[old] && byId[old].fromAtlas, mine: byId[mine] && byId[mine].fromAtlas });

  let res = null;
  try { res = await require("../server/groups/atlasExpiry").expireAtlasGroups(q, { orgId: ORG, now: new Date(now) }); }
  catch (e) { ok("the sweep runs", false, e.message); }
  const left = new Set((await q(`SELECT id FROM audiences WHERE org_id=$1`, [ORG])).map(r => r.id));
  ok("an Atlas group 31 days old is gone", !left.has(old), res);
  ok("its members went with it; the person stays",
     (await q(`SELECT 1 FROM group_members WHERE group_id=$1`, [old])).length === 0
     && (await q(`SELECT 1 FROM donors WHERE id=$1 AND deleted_at IS NULL`, [donor])).length === 1);
  ok("an Atlas group 10 days old stays", left.has(young));
  ok("a renamed Atlas group 31 days old stays", left.has(renamed));
  ok("a pinned Atlas group 31 days old stays", left.has(pinned));
  ok("an Atlas group used in a campaign stays", left.has(sent));
  ok("a group she made, 60 days old, stays", left.has(mine));
  ok("the sweep names the one org it changed, for its audit row", res && res.orgs && res.orgs.length === 1 && res.orgs[0] === ORG && res.counts.groupsRemoved === 1, res);

  await q(`DELETE FROM campaigns WHERE org_id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

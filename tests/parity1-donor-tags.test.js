// tests/parity1-donor-tags.test.js · PARITY-1 test 1. THE TAGS ARE EXACT.
//
//     Giving level (General, Mid, Major at the cut points), lifecycle (New,
//     Current, Recaptured, Lapsed) and Retained match a fixture set of donors
//     exactly, on the profile, in the donor list filter and in each tag's own
//     list (the figure source the tag opens). Moving the cut points in
//     Settings moves the donors across them.
//
// The fixtures sit on the edges: exactly $10,000.00 (Major), $9,999.99 (Mid),
// exactly $1,000.00 (Mid), $999.99 (General), a refund that pulls a donor
// under a cut, a gift 800 days ago (before both windows), and a person who has
// never given (no tag, in no list).
//
// HOW IT WOULD GO RED: a cut compared with > instead of >= (the $10,000.00 and
// $1,000.00 donors drop a level); a refund counted as "gave"; the windows off
// by a day; a tag list built apart from the profile's rule. Proven able to
// fail: changing donorStatus.js's Major test to > turned §1 and §3 red.
//
// Standard scratch stack (tests/README.md), on the battery's own server.

const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_par1t";
const ADMIN = "admin@par1t.local";
const T = civilToday();
const Y = Number(T.slice(0, 4));
const LAST_Y_W1 = `${Y - 1}-01-01`;        // always in last calendar year and in the 12 months before the last 12
const OLD = civilPlusDays(-800);           // before both windows, and never last calendar year

// key: [gifts as [amount, date]], expected level, lifecycle, retained
const F = {
  major:    [[[6000, T], [4000, T], [50, LAST_Y_W1]],       "major",   "current",    true],
  midEdge:  [[[1000, T]],                                    "mid",     "new",        false],
  under:    [[[999.99, T], [5, OLD]],                        "general", "recaptured", false],
  nearMaj:  [[[9999.99, T], [10, LAST_Y_W1]],                "mid",     "current",    true],
  lapsed:   [[[20000, LAST_Y_W1]],                           "general", "lapsed",     false],
  refund:   [[[1500, T], [-600, T]],                         "general", "new",        false],
  oldOnly:  [[[100, OLD]],                                   "general", "lapsed",     false],
  never:    [[],                                             null,      null,         false],
};
const id = k => `d_par1t_${k}`;

(async () => {
  for (const t of ["gifts", "donor_scores", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Parity One Fixture','parity-one-t',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_par1t',$1,$2,$3,'Parity Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  let n = 0;
  for (const [k, [gifts]] of Object.entries(F)) {
    await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,$3,'cultivate','system:test','test')`, [id(k), ORG, `Fixture ${k}`]);
    for (const [amount, date] of gifts)
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
        [`g_par1t_${++n}`, ORG, id(k), amount, date]);
  }
  const tok = await login(ADMIN);

  // The expected membership of every tag, from the fixture table.
  const expected = cuts => {
    const m = {};
    for (const [k, [, level, lc, ret]] of Object.entries(cuts || F)) {
      if (level) (m[level] = m[level] || []).push(id(k));
      if (lc) (m[lc] = m[lc] || []).push(id(k));
      if (ret) (m.retained = m.retained || []).push(id(k));
    }
    for (const t of ["general", "mid", "major", "new", "current", "recaptured", "lapsed", "retained"]) m[t] = (m[t] || []).sort();
    return m;
  };

  async function check(label, table) {
    // §1 The profile: each donor's tags are exactly its row of the table.
    for (const [k, [, level, lc, ret]] of Object.entries(table)) {
      const r = await api("GET", `/donors/${id(k)}/status`, tok);
      const keys = ((r.body && r.body.tags) || []).map(t => t.key);
      const want = [level, lc, ret ? "retained" : null].filter(Boolean);
      ok(`${label} §1 ${k}: the profile shows ${want.join(", ") || "no tags"}`, r.status === 200 && JSON.stringify(keys) === JSON.stringify(want), JSON.stringify(keys));
    }
    const exp = expected(table);
    for (const tag of Object.keys(exp)) {
      // §2 The donor list filter finds exactly those donors.
      const qs = ["general", "mid", "major"].includes(tag) ? `level=${tag}` : tag === "retained" ? "retained=1" : `lifecycle=${tag}`;
      const l = await api("GET", `/donors?limit=200&${qs}`, tok);
      const listIds = ((l.body && l.body.donors) || []).map(d => d.id).sort();
      ok(`${label} §2 the ${tag} filter lists exactly its donors`, JSON.stringify(listIds) === JSON.stringify(exp[tag]), listIds.join(","));
      // §3 The tag's own list (what clicking the tag opens) is the same set.
      const f = await api("GET", `/figures/donors-by-status/rows?tag=${tag}&today=${T}&pageSize=200`, tok);
      const rowIds = ((f.body && f.body.rows) || []).map(w => w.donorId).sort();
      ok(`${label} §3 the ${tag} tag opens exactly its donors`, f.status === 200 && JSON.stringify(rowIds) === JSON.stringify(exp[tag]) && f.body.value === exp[tag].length,
        `${rowIds.join(",")} value ${f.body && f.body.value}`);
    }
  }

  await check("default cuts", F);

  // §4 The cut points come from Settings, Giving levels. At $500 and $5,000
  // the refund donor ($900 net) is Mid and $9,999.99 is Major.
  const put = await api("PUT", "/settings/giving-levels", tok, { mid: "500", major: "5,000" });
  ok("§4 an admin sets the cut points", put.status === 200 && put.body.midCents === 50000 && put.body.majorCents === 500000, JSON.stringify(put.body));
  const bad = await api("PUT", "/settings/giving-levels", tok, { mid: "5000", major: "500" });
  ok("§4 Major has to start above Mid", bad.status === 400, bad.status);
  const moved = JSON.parse(JSON.stringify(F));
  moved.refund[1] = "mid"; moved.nearMaj[1] = "major"; moved.midEdge[1] = "mid"; moved.under[1] = "mid";
  await check("moved cuts", moved);

  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });

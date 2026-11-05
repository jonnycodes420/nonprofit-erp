// server/dataHealth/noticeCount.js · HOTFIX-RHYTHM. THE NOTICE COUNTS WITH TODAY'S RULE.
//
// Home's "Your last import left N possible duplicates" read the number stored
// when the import ran: 4,093 on a 6,400-person file, under the rule that
// matched "n/a" and 000-000-0000. It now counts the import's pairs again with
// the current rule (dataHealth.js findPairs). It reads; it never rewrites the
// stored run. Ten minutes per run, per replica.
"use strict";

module.exports = function noticeCounter({ query, livePeople, pairsAndFamilies }) {
  // How many of the pairs involve people the import created.
  async function importPairs(orgId, importId, people, pairs) {
    const [imp] = await query("SELECT started_at, committed_at FROM imports WHERE id=? AND org_id=?", [importId, orgId]);
    const since = imp && (imp.started_at || imp.committed_at);
    const isNew = d => !!d && (d.created_import_id === importId || (since && new Date(d.created_at) >= new Date(since)));
    const byId = new Map(people.map(d => [d.id, d]));
    return pairs.filter(p => isNew(byId.get(p.a)) || isNew(byId.get(p.b))).length;
  }
  // The Home notice's count for one stored run, counted again with today's rule.
  const NOTICE_TTL_MS = 10 * 60 * 1000;
  const noticeCounts = new Map();
  async function noticeCount(orgId, r) {
    if (!r.import_id) return r.new_duplicates;
    const hit = noticeCounts.get(r.id);
    if (hit && Date.now() - hit.at < NOTICE_TTL_MS) return hit.n;
    const people = await livePeople(orgId);
    const n = await importPairs(orgId, r.import_id, people, (await pairsAndFamilies(orgId, people)).pairs);
    noticeCounts.set(r.id, { n, at: Date.now() });
    if (noticeCounts.size > 500) noticeCounts.delete(noticeCounts.keys().next().value);
    return n;
  }

  return { importPairs, noticeCount };
};

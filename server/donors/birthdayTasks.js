// server/donors/birthdayTasks.js · FLOWS-1 item 8. A BIRTHDAY TASK FOLLOWS THE
// BIRTHDAY.
//
// A yearly task "on their birthday" keeps its month and day in its repeat
// ({ every: "year", month, day, birthday: true }). Changing the person's
// birthday from May 14 to May 15 left the task on May 14, this year and every
// year after. Now an edit to the birthday moves each OPEN birthday task of
// theirs: the repeat takes the new month and day, and the task is due on the
// next time that day comes round (from the org's today). Done tasks, and
// tasks that only happen to repeat yearly, are left alone.
"use strict";

let _ts = null;
const tsMod = async () => _ts || (_ts = await import("../../shared/taskShape.js"));

async function followBirthday({ query, run }, orgId, donorId, birthday, today) {
  if (!birthday || !birthday.month || !birthday.day) return 0;
  const ts = await tsMod();
  const m = Number(birthday.month), d = Number(birthday.day);
  const open = await query(
    `SELECT id, recur FROM tasks WHERE org_id=? AND donor_id=? AND done=0 AND voided_at IS NULL
        AND link_kind IS NULL AND recur->>'birthday' = 'true'`, [orgId, donorId]);
  const move = open.filter(t => Number(t.recur.month) !== m || Number(t.recur.day) !== d).map(t => t.id);
  if (!move.length) return 0;
  const recur = ts.normalizeRecur({ every: "year", month: m, day: d, birthday: true });
  await run(`UPDATE tasks SET recur=?::jsonb, due=?, updated_at=NOW() WHERE org_id=? AND id = ANY(?::text[])`,
    [JSON.stringify(recur), ts.nextYearlyOn(m, d, today), orgId, move]);
  return move.length;
}

module.exports = { followBirthday };

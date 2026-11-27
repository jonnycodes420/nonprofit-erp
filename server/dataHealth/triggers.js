// server/dataHealth/triggers.js · SAFE-EDIT-1 item 4. WHAT MAY START A DATA HEALTH RUN, SAID ONCE.
//
// A restore from Settings, Trash asked for a re-check with the trigger "restore", and the
// table's CHECK constraint (part7.js) allowed only the seven words FIX-59 knew. Every
// restore's re-check failed in the background ("violates check constraint
// data_health_runs_trigger_check") and Data health kept saying it was checked before.
//
// Now the list is here, and only here: the constraint is built from it (the DDL in
// server/db/ddl/builds/2026-11-27-safeedit1.js), runDataHealth refuses a word that is not in it
// before it writes, and tests/fix59-data-health-current.test.js fails when any caller of
// recheckSoon or runDataHealth names a word that is not in it. The page's words for each
// (DataHealth.jsx RUN_WORDS) are checked against it by the same suite.
"use strict";

const TRIGGERS = Object.freeze(["import", "nightly", "manual", "undo", "merge", "merge_undo", "delete", "restore"]);
const isTrigger = t => TRIGGERS.includes(t);
// The CHECK as SQL, from the list (the words are fixed literals above, never input).
const CHECK_SQL = `CHECK (trigger IN (${TRIGGERS.map(t => `'${t}'`).join(",")}))`;

module.exports = { TRIGGERS, isTrigger, CHECK_SQL };

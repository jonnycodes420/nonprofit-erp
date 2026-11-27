// SECURE-DEMO · the password the Harborlight demo's two staff logins get.
//
// The repo is public, so the production demo's password is never written in
// it. Scratch, CI and staging use SCRATCH_PASSWORD, which opens nothing on
// production. A production seed run takes DEMO_ADMIN_PASSWORD (Railway,
// production service) and refuses without it, or with the public scratch one.
//
// rotateDemoPassword is `seed-demo.js --password-only`: it sets the two staff
// logins' password and signs every session of theirs out, and changes nothing
// else. The app refuses a password change on the demo org (a shared login),
// so this is how it rotates. It runs from the seed, after the seed's identity
// guards, because only the seed writes org_b72demo.
const bcrypt = require("bcryptjs");

const SCRATCH_PASSWORD = "demo-harbor-2026";

// -> the password for this run. `refuse` is the seed's stop-with-a-reason.
function demoPassword({ isProdRun, env = process.env, refuse } = {}) {
  const set = String(env.DEMO_ADMIN_PASSWORD || "");
  if (!isProdRun) return set || SCRATCH_PASSWORD;
  const stop = msg => { if (refuse) refuse(msg); throw new Error(msg); };
  if (set.length < 12) stop("a production run needs DEMO_ADMIN_PASSWORD (12 characters or more) set on Railway's production service. The scratch password is public and never goes to production.");
  if (set === SCRATCH_PASSWORD) stop("DEMO_ADMIN_PASSWORD is the public scratch password. Pick a new one.");
  return set;
}

async function rotateDemoPassword({ client, refuse, org, emails, password, env = process.env }) {
  if (!env.DEMO_ADMIN_PASSWORD) refuse("--password-only sets the password from DEMO_ADMIN_PASSWORD. Set it first.");
  const hash = bcrypt.hashSync(password, 12);
  const users = (await client.query(
    `UPDATE users SET password_hash=$1, sessions_valid_after=NOW() WHERE org_id=$2 AND lower(email) = ANY($3) RETURNING id`,
    [hash, org, emails.map(e => e.toLowerCase())])).rows;
  const ended = users.length ? (await client.query(
    `UPDATE user_sessions SET revoked_at=NOW(), revoked_by='system:seed-demo' WHERE revoked_at IS NULL AND user_id = ANY($1) RETURNING id`,
    [users.map(u => u.id)])).rows : [];
  const s = n => (n === 1 ? "" : "s");
  console.log(`[password] ${users.length} demo login${s(users.length)} given the new password; ${ended.length} open session${s(ended.length)} signed out (any other browser follows within 30 seconds). Nothing else changed.`);
  await client.end();
  if (users.length !== emails.length) process.exit(1);
}

module.exports = { SCRATCH_PASSWORD, demoPassword, rotateDemoPassword };

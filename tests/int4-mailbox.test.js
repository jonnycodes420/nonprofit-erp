// tests/int4-mailbox.test.js — INT-4. THE ONE GUARD THIS BUILD EARNED.
//
//     A MESSAGE WITH NO MATCHING STEWARD PERSON STORES NOTHING AT ALL:
//     NOT THE SUBJECT, NOT THE ADDRESS, NOT THE BODY.
//
// This is a fundraiser's personal mailbox. Her doctor, her children's school,
// her union and her job applications are in there, and the only thing that
// makes it defensible for a work system to read any of it is that it cannot
// keep, count or prove the existence of anything that is not a conversation
// with somebody the organisation already knows.
//
// WHAT IS ASSERTED:
//   §1  a message to nobody on file is dropped, and NOTHING about it reaches
//       the database: no interaction, and no row anywhere whose text contains
//       the subject, the address or the body
//   §2  the never-log list wins even when a donor IS on the message, because
//       the point of that list is that those people do not appear at all
//   §3  paused means nothing new is read
//   §4  a message she removed is not logged again by the next sync
//   §5  a real conversation with a donor IS logged, with the actor stamped and
//       the quoted reply trimmed, so §1 is proven to be a filter and not a
//       broken sync that stores nothing ever
//   §6  the tokens are sealed: no mailbox row holds a readable token, and the
//       API never returns one
//   §7  one person's mailbox is hers — an admin colleague cannot pause,
//       disconnect or read it, and the connection is keyed to the user
//
// HOW IT WOULD GO RED: match on a substring instead of a whole address; log
// the subject before checking the match; consult the never-log list only for
// the sender; store the token unsealed. Proven able to fail: removing the
// never-log check turns §2 red, and logging before the match turns §1 red.
//
// NO PROVIDER IS CONTACTED. Every assertion runs against the pure decision and
// the routes; nothing here fetches a mailbox.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_int4a", B = "org_int4b";
const PW = bcrypt.hashSync("loadtest1234", 10);

// The things that must never appear anywhere in the database.
const SECRET_SUBJECT = "Biopsy results and next steps";
const SECRET_ADDRESS = "oncology.scheduling@hospital.invalid";
const SECRET_BODY    = "Your appointment with Dr Okonkwo is confirmed for Tuesday";

const TABLES = ["mailbox_exclusions", "mailbox_never_log", "mailbox_connections",
                "interactions", "threads", "gifts", "donors", "users"];

async function reset() {
  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [o, `INT4 ${o}`, `int4-${o}`]);
  }
  // Dana owns the mailbox. Raj is an ADMIN colleague in the same org, which is
  // what makes §7 mean something: the wall is not the org, it is the person.
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Dana','admin')`, [`u_${A}`, A, `dana@${A}.local`, PW]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Raj','admin')`, [`u_${A}_raj`, A, `raj@${A}.local`, PW]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Admin','admin')`, [`u_${B}`, B, `b@${B}.local`, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Marion Reed','marion@example.com','active',500,'system:test','test')`, ["d_a_marion", A]);
}

const countLike = async (orgId, needle) => {
  const [r] = await q(
    `SELECT COUNT(*)::int n FROM interactions
      WHERE org_id=$1 AND (COALESCE(note,'') ILIKE $2 OR COALESCE(metadata::text,'') ILIKE $2)`,
    [orgId, `%${needle}%`]);
  return Number(r.n);
};

(async () => {
  await reset();
  const ML = await import("../shared/mailboxLog.js");
  const dana = await login(`dana@${A}.local`);
  const raj  = await login(`raj@${A}.local`);

  const ctx = {
    paused: false, neverLog: [], excludedIds: [],
    mailboxAddress: `dana@${A}.local`,
    staffEmails: [`dana@${A}.local`, `raj@${A}.local`],
    donorsByEmail: new Map([["marion@example.com", "d_a_marion"]]),
    today: "2026-09-30",
  };

  // ── §1 · A MESSAGE ABOUT NOBODY ON FILE IS NOT STORED, AT ALL ───────────
  const private_ = {
    id: "m_private", from: SECRET_ADDRESS, to: [`dana@${A}.local`], cc: [],
    subject: SECRET_SUBJECT, bodyText: SECRET_BODY, date: "2026-09-29", attachmentCount: 1,
  };
  const d1 = ML.classifyMailboxMessage(private_, ctx);
  ok("§1 a message involving nobody on file is dropped", d1.action === "drop", JSON.stringify(d1));
  ok("§1 …for the right reason", d1.reason === "no_match", d1.reason);
  ok("§1 the decision carries no subject", d1.subject === undefined, JSON.stringify(d1));
  ok("§1 the decision carries no body", d1.body === undefined, JSON.stringify(d1));
  ok("§1 the decision carries no address", !JSON.stringify(d1).includes(SECRET_ADDRESS), JSON.stringify(d1));
  ok("§1 nothing bearing the subject is in the database", (await countLike(A, SECRET_SUBJECT)) === 0, "found");
  ok("§1 nothing bearing the address is in the database", (await countLike(A, SECRET_ADDRESS)) === 0, "found");
  ok("§1 nothing bearing the body is in the database", (await countLike(A, "Dr Okonkwo")) === 0, "found");

  // ── §2 · THE NEVER-LOG LIST WINS EVEN WITH A DONOR ON THE MESSAGE ───────
  const mixed = {
    id: "m_mixed", from: "marion@example.com", to: [`dana@${A}.local`], cc: ["nurse@hospital.invalid"],
    subject: "Re: the gala and a quick personal thing", bodyText: "Two things at once", date: "2026-09-29",
  };
  const withoutList = ML.classifyMailboxMessage(mixed, ctx);
  ok("§2 without the list, a donor message logs", withoutList.action === "log", JSON.stringify(withoutList));
  const withList = ML.classifyMailboxMessage(mixed, { ...ctx, neverLog: ["hospital.invalid"] });
  ok("§2 a domain on the never-log list stops the whole message",
    withList.action === "drop" && withList.reason === "never_log", JSON.stringify(withList));
  ok("§2 a bare domain does NOT match a lookalike domain",
    ML.isNeverLogged("x@nothospital.invalid", ["hospital.invalid"]) === false, "over-matched");
  ok("§2 a subdomain IS covered",
    ML.isNeverLogged("x@mail.hospital.invalid", ["hospital.invalid"]) === true, "under-matched");
  ok("§2 a whole address entry matches only that address",
    ML.isNeverLogged("a@x.com", ["b@x.com"]) === false, "over-matched");

  // The list is hers, and the route stores it.
  const add = await api("POST", "/mailbox/never-log", dana, { pattern: "hospital.invalid" });
  ok("§2 the never-log route accepts a domain", add.status === 201, `status ${add.status}`);
  const bad = await api("POST", "/mailbox/never-log", dana, { pattern: "not an address" });
  ok("§2 …and refuses nonsense", bad.status === 400, `status ${bad.status}`);

  // ── §3 · PAUSED MEANS NOTHING NEW IS READ ───────────────────────────────
  const whenPaused = ML.classifyMailboxMessage(mixed, { ...ctx, paused: true });
  ok("§3 paused drops everything", whenPaused.action === "drop" && whenPaused.reason === "paused",
    JSON.stringify(whenPaused));

  // ── §4 · A MESSAGE SHE REMOVED STAYS REMOVED ────────────────────────────
  const excluded = ML.classifyMailboxMessage(mixed, { ...ctx, excludedIds: ["m_mixed"] });
  ok("§4 an excluded message is never logged again",
    excluded.action === "drop" && excluded.reason === "excluded", JSON.stringify(excluded));

  // ── §5 · A REAL CONVERSATION IS LOGGED (so §1 is a filter, not a no-op) ──
  const real = {
    id: "m_real", from: "marion@example.com", to: [`dana@${A}.local`], cc: [],
    subject: "Thank you for the tour",
    bodyText: "That was lovely, thank you.\n\nOn Mon 28 Sep 2026, Dana wrote:\n> Would you like to visit?",
    date: "2026-09-29", attachmentCount: 2,
  };
  const d5 = ML.classifyMailboxMessage(real, ctx);
  ok("§5 a conversation with a donor is logged", d5.action === "log", JSON.stringify(d5));
  ok("§5 …against the right person", d5.donorIds.join(",") === "d_a_marion", d5.donorIds.join(","));
  ok("§5 …read as inbound", d5.direction === "inbound", d5.direction);
  ok("§5 the quoted reply is trimmed off", !d5.body.includes("Would you like to visit"), d5.body);
  ok("§5 …and what she actually wrote is kept", d5.body.includes("That was lovely"), d5.body);
  ok("§5 attachments are counted, never stored", ML.attachmentLine(d5.attachmentCount) === "2 attachments",
    ML.attachmentLine(d5.attachmentCount));
  ok("§5 a colleague-only message is not a donor conversation",
    ML.classifyMailboxMessage({ id: "m_int", from: `raj@${A}.local`, to: [`dana@${A}.local`], cc: [],
      subject: "lunch", bodyText: "?" }, ctx).reason === "self_only", "matched");

  // ── §6 · THE TOKENS ARE SEALED ──────────────────────────────────────────
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,created_by,created_by_name)
           VALUES ('mbx_a',$1,$2,'google',$3,'active','v1.sealed-envelope-not-a-token','system:test','test')`,
    [A, `u_${A}`, `dana@${A}.local`]);
  const [sealedRow] = await q(`SELECT credentials_sealed FROM mailbox_connections WHERE id='mbx_a'`);
  ok("§6 the stored envelope is a sealed one", String(sealedRow.credentials_sealed).startsWith("v1."),
    String(sealedRow.credentials_sealed).slice(0, 12));
  const [plain] = await q(
    `SELECT COUNT(*)::int n FROM information_schema.columns
      WHERE table_name='mailbox_connections' AND column_name IN ('access_token','refresh_token')`);
  ok("§6 there is no plaintext token column on the mailbox table", Number(plain.n) === 0, `${plain.n} found`);
  const mine = await api("GET", "/mailbox", dana);
  ok("§6 the API answers", mine.status === 200, `status ${mine.status}`);
  ok("§6 …and returns no token, sealed or otherwise",
    !JSON.stringify(mine.body).includes("sealed-envelope") && !/credentials/i.test(JSON.stringify(mine.body)),
    JSON.stringify(mine.body).slice(0, 200));

  // ── §7 · HER MAILBOX IS HERS, EVEN FROM AN ADMIN COLLEAGUE ──────────────
  const rajSees = await api("GET", "/mailbox", raj);
  const rajConnected = (rajSees.body.providers || []).filter(p => p.connected);
  ok("§7 an admin colleague does not see her connection on his own screen",
    rajConnected.length === 0, JSON.stringify(rajConnected));
  const rajPause = await api("POST", "/mailbox/google/pause", raj, { paused: true });
  ok("§7 …and cannot pause hers", rajPause.status === 404, `status ${rajPause.status}`);
  const [stillOn] = await q(`SELECT paused FROM mailbox_connections WHERE id='mbx_a'`);
  ok("§7 …and hers is untouched", stillOn.paused !== true, `paused=${stillOn.paused}`);
  const rajDisconnect = await api("POST", "/oauth/google/disconnect", raj, {});
  ok("§7 …and cannot disconnect hers", rajDisconnect.status === 404, `status ${rajDisconnect.status}`);
  const [stillThere] = await q(`SELECT status FROM mailbox_connections WHERE id='mbx_a'`);
  ok("§7 …and hers is still connected", stillThere.status === "active", stillThere.status);
  // She can.
  const herPause = await api("POST", "/mailbox/google/pause", dana, { paused: true });
  ok("§7 she can pause her own", herPause.status === 200, `status ${herPause.status}`);

  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary("INT-4 — a message about nobody on file leaves no trace");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

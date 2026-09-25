// BUILD-96 Part 4 — ZEFFY AND SQUARE, HONEST ON EVERY SURFACE.
//
// Both adapters are merged and green. NEITHER HAS EVER SEEN A REAL PAYLOAD.
// There is an organisation in the pipeline for each — Hooves of Hope on Zeffy,
// Justin's Place on Square — and the temptation at exactly this moment is to
// let them sit in the product looking like PayPal.
//
// BUILD-91's rule decides the public surface: a source enters the marketing
// allowlist only after a real dollar has moved through a real account. That
// allowlist is still EMPTY and this suite pins it.
//
// In-app is the surface this build adds. "Available, being verified with a
// first organization" is what is actually true, and the ask beside it is the
// one thing Jonathan needs from that organisation.
//
// AND THE ZEFFY HALF IS NOT COPY, IT IS BEHAVIOUR. Zeffy runs its own dunning:
// 4-5 retries about four days apart, each with a card-update link to the
// donor. If Steward also sent its reconnect link, a donor would get two emails
// from two systems about the same card. So for a Zeffy org the engine is OFF —
// and off at the ROUTE, not merely hidden on the screen, because a hidden
// button is one a saved link still reaches.
//
//   §1  the public allowlist is still empty, and Square is not on it
//   §2  the in-app sentence and the ask, for both
//   §3  a Zeffy org sends ZERO reconnect emails, and is told whose job it is
//   §4  a non-Zeffy org is unaffected — the engine is off for a reason, not off
//
// Standard scratch stack (tests/README.md).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ZORG = "org_b96z", SORG = "org_b96s";
const ZADMIN = "b96z-admin@example.org", SADMIN = "b96s-admin@example.org";

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

async function reset() {
  for (const o of [ZORG, SORG]) {
    await q(`DELETE FROM reconnect_sends WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM giving_sources WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM gifts WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  await reset();

  // ── §1 · the public row ──────────────────────────────────────────────────
  console.log("\n— §1 · neither is on the page a stranger reads —");

  const pub = read("shared/publicSources.js");
  const listed = /export const PUBLIC_SOURCE_ALLOWLIST = \[([^\]]*)\]/.exec(pub);
  ok("the allowlist is found", !!listed, true);
  ok("THE ALLOWLIST IS STILL EMPTY — no source has met all three conditions",
     listed && listed[1].trim() === "", listed && listed[1]);
  ok("...so Zeffy is not on it", !/PUBLIC_SOURCE_ALLOWLIST = \[[^\]]*zeffy/.test(pub), true);
  ok("...and neither is Square", !/PUBLIC_SOURCE_ALLOWLIST = \[[^\]]*square/.test(pub), true);
  ok("Square is still MIRRORED in PUBLIC_SOURCES — the mirror is the registry, the allowlist is the claim",
     /square:\s*\{\s*label: "Square"/.test(pub), true);

  // ── §2 · the in-app sentence ─────────────────────────────────────────────
  console.log("\n— §2 · what Integrations says about an unverified adapter —");

  const settings = read("client/src/components/Settings.jsx");
  ok("the exact sentence is there, verbatim",
     settings.includes("Available, being verified with a first organization."), true);
  ok("Zeffy's ask names a read-only API key",
     /zeffy:\s*"To be one of the first: a read-only API key from your Zeffy account\."/.test(settings), true);
  ok("Square's ask names a production access token",
     /square:\s*"To be one of the first: a production access token from your Square account\."/.test(settings), true);
  ok("Square is shown on the page at all — it was missing from DIRECT_ORDER entirely",
     /const DIRECT_ORDER=\[[^\]]*"square"/.test(settings), true);
  ok("...and the sentence is shown only while nothing is connected",
     /const verifying=state==="none"&&VERIFYING\[k\]/.test(settings), true);
  // Nothing else is promised on that screen.
  ok("no date, no 'coming soon', no 'beta' on the verifying tiles",
     !/coming soon/i.test(settings) && !/\bbeta\b/i.test(settings), true);

  const reg = read("shared/givingSources.js");
  ok("the registry records that Zeffy runs its OWN dunning",
     /dunning: "provider"/.test(reg), true);
  ok("...with the sentence the screen shows, held beside it",
     reg.includes("Zeffy retries the card and emails your donor. Steward tells you when a monthly gift has stopped."), true);

  // ── §3 · a Zeffy org sends nothing ───────────────────────────────────────
  console.log("\n— §3 · a Zeffy org, a stopped monthly gift, and zero reconnect emails —");

  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [org, slug, email, uid] of [[ZORG, "b96z", ZADMIN, "u_b96z"], [SORG, "b96s", SADMIN, "u_b96s"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [org, "Org " + slug, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Admin','admin')`, [uid, org, email, hash]);
  }
  // The Zeffy org has Zeffy connected; the other org has nothing.
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status)
           VALUES ('gs_b96z',$1,'zeffy','Zeffy','active')`, [ZORG]);

  // An imported sustainer whose monthly gift has stopped — the exact row the
  // reconnect engine exists for.
  for (const org of [ZORG, SORG]) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,imported_sustainer,
                                 imported_sustainer_amount,imported_sustainer_last_gift)
             VALUES ($1,$2,'Stopped Sustainer',$3,'steward',true,25,CURRENT_DATE - 200)`,
            [`d_${org}_1`, org, `sustainer-${org}@example.org`]);
  }

  const zTok = await login(ZADMIN);
  const sTok = await login(SADMIN);

  const zView = await api("GET", "/recurring/unlinked", zTok);
  ok("the Zeffy org's Recurring screen loads", zView.status === 200, zView.status);
  ok("...and says the PROVIDER owns the retries", zView.body.dunning?.engine === "provider", zView.body.dunning);
  ok("...naming Zeffy", zView.body.dunning?.provider === "zeffy", zView.body.dunning);
  ok("...with the exact sentence",
     zView.body.dunning?.sentence === "Zeffy retries the card and emails your donor. Steward tells you when a monthly gift has stopped.",
     zView.body.dunning);
  ok("...and the stopped sustainer is STILL LISTED — Steward's job is telling her, not retrying",
     Array.isArray(zView.body.list) && zView.body.list.length === 1, zView.body.list);

  const before = (await q(`SELECT COUNT(*)::int AS c FROM reconnect_sends WHERE org_id=$1`, [ZORG]))[0].c;
  const zSend = await api("POST", "/recurring/unlinked/send-reconnect", zTok, { donorIds: [`d_${ZORG}_1`] });
  ok("THE SEND IS REFUSED AT THE ROUTE — not merely hidden on the screen",
     zSend.status === 409, zSend.status);
  ok("...naming the provider as the reason", zSend.body.error === "dunning_belongs_to_provider", zSend.body);
  ok("...and saying it in the same words the screen does",
     zSend.body.message === zView.body.dunning.sentence, zSend.body.message);
  ok("ZERO RECONNECT EMAILS — not one row was written",
     (await q(`SELECT COUNT(*)::int AS c FROM reconnect_sends WHERE org_id=$1`, [ZORG]))[0].c === before);

  const rg = read("client/src/components/RecurringGiving.jsx");
  ok("the screen hides the send button for a provider-dunning org",
     /!isReadOnly && !providerDunning && sendable\.length > 0/.test(rg), true);
  ok("...and the per-row send control too",
     /!isReadOnly && !providerDunning && u\.email/.test(rg), true);
  ok("...and shows the sentence instead", /data-testid="recurring-dunning-note"/.test(rg), true);

  // ── §4 · and an org NOT on Zeffy still has the engine ────────────────────
  console.log("\n— §4 · the engine is off for a reason, not off —");

  const sView = await api("GET", "/recurring/unlinked", sTok);
  ok("an org with no provider dunning keeps Steward's engine",
     sView.body.dunning?.engine === "steward", sView.body.dunning);
  ok("...and says nothing about somebody else's retries",
     sView.body.dunning?.sentence === null, sView.body.dunning);

  const sSend = await api("POST", "/recurring/unlinked/send-reconnect", sTok, { donorIds: [`d_${SORG}_1`] });
  ok("...and its send is NOT refused", sSend.status !== 409, { status: sSend.status, body: sSend.body });

  // Disconnecting Zeffy hands the job back.
  await q(`UPDATE giving_sources SET status='disconnected' WHERE id='gs_b96z'`);
  const zAfter = await api("GET", "/recurring/unlinked", zTok);
  ok("a DISCONNECTED Zeffy hands the retries back to Steward",
     zAfter.body.dunning?.engine === "steward", zAfter.body.dunning);

  // ── §5 · the asks are written down ───────────────────────────────────────
  console.log("\n— §5 · what Jonathan asks each of them —");

  // The 53 BLOCKED-*.md files are gone (2026-09-25); anything that physically
  // requires Jonathan lives in ONE file, NEEDS-JONATHAN.md, and everything else
  // was decided. These two asks are the reason that file has to keep naming a
  // PERSON: "get a Zeffy key" is a task nobody owns, and an unowned task is how
  // an adapter sits unverified for a month.
  const needs = read("NEEDS-JONATHAN.md");
  ok("the Zeffy ask names who", /\*\*Laura\*\*/.test(needs), true);
  ok("...and asks for a read-only API key", /read-only API key/.test(needs), true);
  ok("the Square ask names who", /\*\*Allie\*\*/.test(needs), true);
  ok("...and asks for a production access token", /production access token/.test(needs), true);
  ok("...and for the one thing Square cannot answer alone — which location or item is a donation",
     /count as donations/.test(needs), true);
  ok("the file holds ONLY what physically requires him, and says so",
     /\*\*physically requires you\*\*/.test(needs), true);
  ok("...and no BLOCKED-*.md file survives to disagree with it",
     require("fs").readdirSync(require("path").join(__dirname, ".."))
       .filter(f => /^BLOCKED-.*\.md$/.test(f)).length === 0, true);

  await reset();
  await closeDb();
  summary();
})();

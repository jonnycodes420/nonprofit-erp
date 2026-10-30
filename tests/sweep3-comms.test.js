// tests/sweep3-comms.test.js: SWEEP-3. COMMUNICATIONS SAYS WHO IT REACHES AND
// WHAT A DONOR WILL READ. Guards email and donor data: the walk of 30 Oct
// (docs/sweeps/sweep-3/walk.md) found a campaign to "Lapsed" that reached
// nobody beside an Audience tab counting 42 lapsing or lapsed, every template
// previewed as the signed-in staff member ("Dear Allie"), the automatic-email
// previews thanking donors for a gift "to your organization", a receipt with
// "[org address]" in it, and a year-end statement calling itself a receipt.
//
//   §1 a campaign to Lapsed is the lapse rule: segment-preview counts the same
//      people the Audience tab's Lapsing or lapsed does, and the hub agrees.
//   §2 a template's preview with nobody chosen is one of the org's donors (the
//      newest giver), never the signed-in staff member; "me" is still her, and
//      a test send goes to her as her.
//   §3 an automatic email's sample preview names the org and greets a donor of
//      the org, never "your organization" or "Sam".
//   §4 the receipt's preview never prints "[org address]"; it says where to add it.
//   §5 the default tax language says nothing about "this receipt", so it reads
//      right on a year-end statement too.
//
// HOW IT GOES RED ON MAIN (2b4951a): Lapsed counts 0 against the Audience
// tab's 2 (§1); the preview says "Dear Allie" (§2); the sample says "your
// organization" and "Hi Sam" (§3); the receipt preview carries "[org address]"
// (§4); the tax language says "unless this receipt says so" (§5).
//
// Standard scratch stack (tests/README.md). Sends nothing. The clock is not pinned.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_sweep3_comms";
const PASSWORD = "loadtest1234";
const P = k => `d_sweep3_${k}`;

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Staffer','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const text = html => String(html || "").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

(async () => {
  try {
    const tok = await freshOrg(ORG, "Lantern House");
    const today = require("./clock").civilDay();
    const yearsAgo = n => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;
    // Two lapsed givers (last gift two and three years ago), one current giver
    // who gave most recently, and one with no email. Nobody's stage is "lapsed".
    const people = [["old1", "Rowan Ashby", "rowan@example.org", yearsAgo(2)], ["old2", "Mira Calder", "mira@example.org", yearsAgo(3)],
                    ["new", "Tess Okafor", "tess@example.org", today], ["noemail", "Ivo Brandt", null, yearsAgo(2)]];
    for (const [k, name, email, day] of people) {
      await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'steward','["donor"]','system:test','test')`, [P(k), ORG, name, email]);
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,120,$4,'system:test','test')`, [`g_sweep3_${k}`, ORG, P(k), day]);
    }

    // ── §1 Lapsed is the lapse rule
    const aud = await api("GET", "/communications/audience", tok);
    const lapsedTab = ((aud.body.segments || []).find(s => s.id === "lapsed") || {}).count;
    const seg = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "lapsed" } });
    const total = seg.body && seg.body.audience && seg.body.audience.total;
    ok("§1 the Audience tab counts the two lapsed givers with an email", lapsedTab === 2, { lapsedTab });
    const noEmail = ((seg.body && seg.body.audience && seg.body.audience.groups) || []).filter(g => g.reason === "no_email").reduce((n, g) => n + g.count, 0);
    ok("§1 a campaign to Lapsed is the three lapsed givers (it read a stage nothing sets: 0), and those with an email are the Audience tab's",
       seg.status === 200 && total === 3 && noEmail === 1 && total - noEmail === lapsedTab, { status: seg.status, total, noEmail, lapsedTab, line: seg.body && seg.body.audience && seg.body.audience.line });

    // ── §2 the preview is one of her donors
    const started = await api("POST", "/email-templates", tok, { starterKey: "person_thanks_first" });
    const tid = started.body && (started.body.template ? started.body.template.id : started.body.id);
    ok("§2 the first-gift thank-you opens in the editor", (started.status === 200 || started.status === 201) && !!tid, { status: started.status, body: started.body });
    const pv = await api("POST", `/email-templates/${tid}/preview`, tok, {});
    const said = text(pv.body && pv.body.html);
    ok("§2 with nobody chosen the preview greets the newest giver, not the signed-in staff member",
       pv.status === 200 && /Dear Tess\b/.test(said) && !/Allie/.test(said) && pv.body.as && pv.body.as.id === P("new"), { status: pv.status, said: said.slice(0, 200), as: pv.body && pv.body.as });
    const mine = await api("POST", `/email-templates/${tid}/preview`, tok, { as: "me" });
    ok("§2 Preview as yourself is still her", mine.status === 200 && /Dear Allie\b/.test(text(mine.body.html)) && !(mine.body.as && mine.body.as.id), text(mine.body && mine.body.html).slice(0, 160));

    // ── §3 the automatic-email sample is the org's
    const smp = await api("GET", "/mail-types/gift_receipt/preview", tok);
    const st = text(smp.body && smp.body.html);
    ok("§3 the sample receipt names the org and greets one of its donors",
       smp.status === 200 && /Lantern House/.test(smp.body.subject || "") && /gift to Lantern House/.test(st) && /Hi Tess,/.test(st) && !/your organization|Hi Sam/.test(st + smp.body.subject),
       { subject: smp.body && smp.body.subject, said: st.slice(0, 220) });

    // ── §4 no "[org address]" in the receipt
    const rc = await api("POST", "/email-templates", tok, { starterKey: "person_receipt" });
    const rid = rc.body && (rc.body.template ? rc.body.template.id : rc.body.id);
    const rpv = await api("POST", `/email-templates/${rid}/preview`, tok, {});
    const rs = text(rpv.body && rpv.body.html);
    ok("§4 the receipt preview never prints [org address], and says where to add it",
       rpv.status === 200 && !/\[org address\]/.test(rs) && (rpv.body.problems || []).some(p => /mailing address/.test(p) && /Tax Receipts/.test(p)),
       { said: rs.slice(0, 260), problems: rpv.body && rpv.body.problems });

    // ── §5 the tax language reads right on a statement
    const BK = await import("../shared/brandKit.js");
    const tax = BK.DEFAULT_TAX_LANGUAGE("Lantern House");
    ok("§5 the default tax language does not call a year-end statement a receipt", !/receipt/i.test(tax) && /^Lantern House is a tax-exempt organization\./.test(tax), tax);
  } catch (e) { console.error(e); ok("the suite ran to the end", false, e.message); }
  await closeDb();
  summary("sweep3-comms");
})();

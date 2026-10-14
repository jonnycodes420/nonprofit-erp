// tests/fix39-campaigns.test.js — FIX-39. COMMUNICATIONS › CAMPAIGNS READS
// CLEAN, AND EVERY EMAIL AND PAGE OPENS IN THE EDITOR.
//
// Guards donor mail: what a campaign says it will send, to whom, and whether a
// template edit changes something already going out.
//
//   §table   one campaigns table on the demo (the "Sent" table that listed a
//            campaign waiting for approval is gone), and the tab's count is
//            the number of rows under its default filter (it said 10 for 2:
//            it counted the eight fundraising goals that share the table).
//   §words   no status code, no {{merge tag}}, no numeric m/d/yyyy date and
//            no emoji on any Communications tab.
//   §fit     the Waiting-for-approval row's Sent cell reads "Not yet" and
//            nothing overlaps the badge, at 1440 and at 390.
//   §delete  Delete is in More and asks before it deletes (we say No).
//   §editor  "Edit in editor" opens the campaign and its template; Back comes
//            back to the same screen; a sent campaign opens read-only with
//            "Duplicate to edit"; journeys and giving pages have the button.
//   §draft   editing a template a running journey uses saves a DRAFT that
//            names what it changes; the live words do not move until Publish.
//
// The browser leg (playwright, against client/dist, so it runs in the browser
// shard) READS the demo org (director@harborlight.demo; run-all seeds it with
// scripts/seed-demo.js before the battery), as smoke-walk does, and never saves there: Delete is answered No, and the editors are
// opened and left. Everything that writes runs on this suite's own org.
//
// RED ON MAIN (2026-10-14): §table (two tables; tab 10 vs 2 rows), §words
// (awaiting_approval, {{first_name}}, 4/27/2026, the alarm clock), §fit (the
// Sent cell wrapped "Not sent yet" into the badge at 390), §delete (a red x
// deleted at once) and §editor/§draft (no such button, no such route).
const path = require("path");
const bcrypt = require("bcryptjs");
const h = require("./helpers");
const { ok, api, q } = h;
const B = require("./polish1/browser-p567");

const ORG = "org_fix39_campaigns";
const ADMIN = "admin@fix39-campaigns.test";
const DEMO = "director@harborlight.demo";
const CODES = ["awaiting_approval", "draft", "scheduled", "sending", "sent", "failed"];
const NUMERIC_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
const EMOJI = /\p{Extended_Pictographic}/u;

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
  }
}

// Every code that reads as a machine wrote it: a snake_case status anywhere,
// or a bare lowercase status alone on a line.
function codesIn(text) {
  const hits = [];
  for (const line of text.split("\n").map(l => l.trim())) {
    if (CODES.includes(line)) hits.push(line);
    const m = line.match(/\b[a-z]+_[a-z_]+\b/g);
    if (m) hits.push(...m.filter(w => CODES.includes(w) || /_(approval|review|pending)$/.test(w)));
  }
  return hits;
}

async function demoSignIn(b, viewport) {
  const li = await api("POST", "/auth/login", null, { email: DEMO, password: "demo-harbor-2026" });
  if (li.status !== 200) return null;
  const ctx = await b.browser.newContext({ viewport, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [li.body.token, JSON.stringify(li.body.user || {}), JSON.stringify(li.body.org || {})]);
  return { ctx, page: await ctx.newPage() };
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function main() {
  console.log("\nFIX-39 · campaigns read clean, every email and page opens in the editor\n");
  await wipe();
  try {
    // ── §draft — on this suite's own org ─────────────────────────────────
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
             VALUES ($1,'FIX-39 Campaigns','fix39-campaigns',1,'active','team','America/New_York')`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix39',$1,$2,$3,'Fix Admin','admin')`,
      [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
    const tok = (await api("POST", "/auth/login", null, { email: ADMIN, password: "loadtest1234" })).body.token;
    const made = await api("POST", "/email-templates", tok, { starterKey: "thank_you" });
    const tplId = made.body && made.body.template && made.body.template.id;
    ok("§draft a template to edit", !!tplId, made.status);
    const before = (await q(`SELECT subject, blocks FROM email_templates WHERE id=$1`, [tplId]))[0];
    // A running journey whose email step drafts from it.
    const j = await api("POST", "/journeys", tok, { name: "Thank new donors", trigger: "first_gift", active: true,
      steps: [{ type: "send", label: "Thank them", offsetDays: 0, draft: "template:" + tplId }] });
    ok("§draft a journey drafts from it", (j.status === 200 || j.status === 201) && j.body && j.body.id, [j.status, JSON.stringify(j.body).slice(0, 200)]);
    // Switched on: the fixture's setup, the way a person turns one on.
    if (j.body && j.body.id) await q(`UPDATE cultivation_templates SET journey_enabled=true WHERE id=$1 AND org_id=$2`, [j.body.id, ORG]);
    const usage = await api("GET", `/email-templates/${tplId}/usage`, tok);
    ok("§draft the template knows what uses it", usage.status === 200 && usage.body.live === true && /journey/i.test(usage.body.sentence || ""),
      [usage.status, usage.body]);
    const put = await api("PUT", `/email-templates/${tplId}`, tok, { subject: "A new subject from FIX-39" });
    ok("§draft editing it saves a draft", put.status === 200 && put.body.draft === true, [put.status, JSON.stringify(put.body).slice(0, 300)]);
    ok("§draft …and names what it changes", /journey/i.test(JSON.stringify(put.body.usage || {})), put.body.usage);
    const live = (await q(`SELECT subject FROM email_templates WHERE id=$1`, [tplId]))[0];
    ok("§draft …and the live words do not move", live.subject === before.subject, [live.subject, before.subject]);
    const pub = await api("POST", `/email-templates/${tplId}/publish`, tok, {});
    const after = (await q(`SELECT subject FROM email_templates WHERE id=$1`, [tplId]))[0];
    ok("§draft Publish makes it live", pub.status === 200 && after.subject === "A new subject from FIX-39", [pub.status, after.subject]);

    // ── the browser leg, reading the demo ────────────────────────────────
    const b = await B.open(h, "§browser");
    if (!b) return;
    try {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const w = viewport.width;
        const s = await demoSignIn(b, viewport);
        ok(`§table ${w} the demo is seeded`, !!s);
        if (!s) continue;
        const { ctx, page } = s;
        await page.goto(b.APP + "/app/communications?subtab=campaigns", { waitUntil: "domcontentloaded", timeout: 45000 });
        await settle(page);

        // §table
        const tables = await page.locator('[data-testid="campaigns-table"]').count();
        const oldSent = await page.locator('[data-testid="sent-campaigns"]').count();
        ok(`§table ${w} one campaigns table`, tables === 1 && oldSent === 0, { tables, oldSent });
        const rows = await page.locator('[data-testid="camp-row"]').count();
        const badge = await page.evaluate(() => {
          const tab = [...document.querySelectorAll("button, [role=tab]")].find(x => /^\s*Campaigns\s*\d*\s*$/.test(x.innerText || ""));
          const m = tab && /(\d+)/.exec(tab.innerText);
          return m ? Number(m[1]) : null;
        });
        ok(`§table ${w} the tab count is the rows under All`, rows > 0 && badge === rows, { badge, rows });

        // §fit
        const fit = await page.evaluate(() => {
          const row = document.querySelector('[data-testid="camp-row"][data-status="awaiting_approval"]');
          if (!row) return { missing: true };
          const cell = row.querySelector('[data-testid="camp-row-sent"]');
          const badge = row.querySelector('[data-testid="camp-status"]');
          const a = cell.getBoundingClientRect(), b2 = badge.getBoundingClientRect();
          const overlap = !(a.right <= b2.left || b2.right <= a.left || a.bottom <= b2.top || b2.bottom <= a.top);
          const badgeCell = badge.parentElement.getBoundingClientRect();
          return { text: cell.innerText.replace(/^Sent\s*/, "").trim(), overlap,
                   badgeInside: b2.left >= badgeCell.left - 1 && b2.right <= badgeCell.right + 1 };
        });
        ok(`§fit ${w} Waiting for approval: Sent reads "Not yet"`, fit.text === "Not yet", fit);
        ok(`§fit ${w} …and nothing overlaps the badge`, fit.overlap === false && fit.badgeInside === true, fit);

        // §words on every Communications tab
        const tabNames = await page.evaluate(() => [...document.querySelectorAll(".comm-tabbar button")].map(x => x.innerText.replace(/\s*\d+\s*$/, "").trim()).filter(Boolean));
        ok(`§words ${w} the tabs are there`, tabNames.length >= 6, tabNames);
        for (const name of tabNames) {
          await page.locator(".comm-tabbar button", { hasText: name }).first().click();
          await settle(page);
          const text = await page.evaluate(() => document.body.innerText);
          ok(`§words ${w} ${name}: no status code`, codesIn(text).length === 0, codesIn(text).slice(0, 5));
          ok(`§words ${w} ${name}: no {{merge tag}}`, !text.includes("{{"), (text.match(/[^\n]*\{\{[^\n]*/) || [])[0]);
          ok(`§words ${w} ${name}: no numeric date`, !NUMERIC_DATE.test(text), (text.match(NUMERIC_DATE) || [])[0]);
          ok(`§words ${w} ${name}: no emoji`, !EMOJI.test(text), (text.match(EMOJI) || [])[0]);
        }

        if (w === 1440) {
          await page.goto(b.APP + "/app/communications?subtab=campaigns", { waitUntil: "domcontentloaded" });
          await settle(page);
          const before = await page.locator('[data-testid="camp-row"]').count();
          // §delete
          const yearEnd = page.locator('[data-testid="camp-row"][data-status="awaiting_approval"]');
          await yearEnd.locator('[data-testid="camp-more"]').click();
          await yearEnd.locator('[data-testid="camp-delete"]').click();
          const asked = await page.locator('[data-testid="confirm-yes"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
          ok("§delete Delete asks before it deletes", asked);
          if (asked) await page.locator('[data-testid="confirm-no"]').click();
          await settle(page);
          ok("§delete …and No keeps it", (await page.locator('[data-testid="camp-row"]').count()) === before);

          // §editor: the campaign, its template, and Back
          await yearEnd.locator('[data-testid="edit-in-editor"]').click();
          await page.locator('[data-testid="campaign-builder"]').waitFor({ timeout: 8000 }).catch(() => {});
          ok("§editor Edit in editor opens the campaign", await page.locator('[data-testid="campaign-builder"]').isVisible());
          const tplBtn = page.locator('[data-testid="campaign-builder"] [data-testid="edit-in-editor"]');
          ok("§editor …which offers its template's editor", (await tplBtn.count()) === 1);
          if (await tplBtn.count()) {
            await tplBtn.click(); await settle(page);
            const inEditor = await page.locator('[data-testid="email-editor"]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
            ok("§editor the template opens in the email editor", inEditor && !(await page.locator('[data-testid="campaign-builder"]').isVisible()));
            await page.getByRole("button", { name: /^Back/ }).first().click(); await settle(page);
            ok("§editor Back returns to the campaign", await page.locator('[data-testid="campaign-builder"]').isVisible());
          }
          await page.locator('[data-testid="campaign-builder"] button', { hasText: "Back" }).first().click(); await settle(page);
          ok("§editor Back returns to the campaigns", (await page.locator('[data-testid="campaigns-table"]').count()) === 1);

          // §editor: a sent campaign opens read-only
          const sent = page.locator('[data-testid="camp-row"][data-status="sent"]');
          ok("§editor a sent row has no Edit in editor", (await sent.locator('[data-testid="edit-in-editor"]').count()) === 0);
          await sent.locator('[data-testid="camp-view"]').click(); await settle(page);
          ok("§editor a sent campaign opens read-only", await page.locator('[data-testid="campaign-read-only"]').isVisible());
          ok("§editor …with Duplicate to edit", await page.locator('[data-testid="duplicate-to-edit"]').isVisible());
          const editable = await page.evaluate(() => [...document.querySelectorAll('[data-testid="campaign-builder"] input, [data-testid="campaign-builder"] textarea')].filter(x => !x.matches(":disabled")).length);
          ok("§editor …and none of its fields can change", editable === 0, editable);
          ok("§editor …and no Save or Send", (await page.locator('[data-testid="campaign-send"]').count()) === 0 && (await page.locator('[data-testid="campaign-builder"] button', { hasText: "Save draft" }).count()) === 0);

          // §editor: the other screens in docs/fix-39/edit-everywhere.md
          for (const [where, url] of [["Fundraising pages", "/app/fundraising?fr=pages"], ["Journeys", "/app/journeys?journey=ct_b72_emails"]]) {
            await page.goto(b.APP + url, { waitUntil: "domcontentloaded" }); await settle(page);
            const btns = page.locator('[data-testid="edit-in-editor"], [data-edit-in-editor]');
            const n2 = await btns.count();
            ok(`§editor ${where} shows Edit in editor`, n2 > 0, n2);
            if (!n2) continue;
            const from = page.url();
            await btns.first().click(); await settle(page);
            const there = page.url();
            ok(`§editor ${where}: it opens the editor`, there !== from && /portal-editor|subtab=templates/.test(there), there);
            await page.getByRole("link", { name: /Back/ }).or(page.getByRole("button", { name: /^(← )?Back/ })).first().click(); await settle(page);
            ok(`§editor ${where}: Back returns to the same screen`, new URL(page.url()).pathname === new URL(from).pathname, [page.url(), from]);
          }
        }
        await ctx.close();
      }
    } finally { await b.browser.close(); }
  } catch (e) {
    ok("ran to the end", false, String(e && e.stack || e).slice(0, 600));
  } finally { await wipe(); }
}

main().then(async () => { await h.closeDb(); h.summary(); }).catch(e => { console.error(e); process.exit(1); });

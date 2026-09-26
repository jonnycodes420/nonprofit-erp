// BUILD-86 C.3 — FOUR DASHBOARDS. Run: node tests/dashboards.test.js
//
//   §1  THE REGISTRY. Every number on every dashboard has a one-sentence
//       definition, and the test WALKS the registry so a metric added without
//       one cannot reach a screen. This is the guard the whole build turns on:
//       "stewardship debt" sat on a screen for two months and nobody could
//       define it in a sentence a board member would accept.
//   §2  FOUR QUESTIONS, live, each answering on one screen.
//   §3  0.6 ANSWERED — "Gifts not yet thanked" counts only gifts dated on or
//       after the org's Steward start date. An imported file is history.
//   §4  THE PDF EQUALS THE SCREEN IN CENTS.
//   §5  The Team-only metrics are behind the plan flag.
//   §6  Org A never appears on org B's dashboards.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const ORG = "org_b86d", ORG2 = "org_b86d2";
const root = path.join(__dirname, "..");
const TABLES = ["threads", "recurring_subscriptions", "payment_recovery_events", "pledges", "grants",
  "milestone_drafts", "opportunities", "digest_sends", "tasks", "interactions", "gifts", "donors",
  "users", "fin_transactions", "budgets", "accounts", "fin_funds"];

// pdfkit Flate-compresses its streams and writes text as hex inside TJ arrays.
function pdfText(buf) {
  const chunks = []; let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i); if (s < 0) break;
    let p = s + 6; if (buf[p] === 13) p++; if (buf[p] === 10) p++;
    const e = buf.indexOf("endstream", p); if (e < 0) break;
    try { chunks.push(zlib.inflateSync(buf.slice(p, e)).toString("latin1")); } catch {}
    i = e + 9;
  }
  const all = chunks.join("\n"); const out = [];
  for (const m of all.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    let s = "";
    for (const h of m[1].matchAll(/<([0-9A-Fa-f]*)>/g)) s += Buffer.from(h[1], "hex").toString("latin1");
    if (s.trim()) out.push(s);
  }
  for (const m of all.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    const s = m[1].replace(/\\([()\\])/g, "$1"); if (s.trim()) out.push(s);
  }
  return out.join("\n");
}
const cents = n => Math.round((Number(n) || 0) * 100);

(async () => {
  const D = await import("../shared/dashboards.js");

  // ── §1 · the registry ────────────────────────────────────────────────────
  console.log("\n— §1 · nothing on a screen without a definition —");
  ok("there are four dashboards, each with a question",
     D.DASHBOARDS.length === 4 && D.DASHBOARDS.every(d => d.question && d.question.endsWith("?")),
     D.DASHBOARDS.map(d => [d.key, d.question]));
  ok("the four are Board, Fundraising, People and Recurring",
     D.DASHBOARD_KEYS.join(",") === "board,fundraising,people,recurring", D.DASHBOARD_KEYS);

  const metrics = D.allMetrics();
  const missing = metrics.filter(m => !m.definition);
  ok("EVERY metric on EVERY dashboard has a definition", missing.length === 0,
     missing.map(m => `${m.dashboard}.${m.key}`));

  // A definition is a SENTENCE, not a label repeated back or a formula.
  const R = D.DEFINITION_RULES;
  const tooShort = metrics.filter(m => m.definition.length < R.minLength);
  ok("…each is long enough to be a sentence", tooShort.length === 0, tooShort.map(m => `${m.key}: ${m.definition}`));
  const noStop = metrics.filter(m => !m.definition.endsWith("."));
  ok("…each ends as a sentence", noStop.length === 0, noStop.map(m => m.key));
  const lazy = metrics.filter(m => R.bannedOpeners.test(m.definition));
  ok("…and none opens by restating its own label (\"the number of…\")", lazy.length === 0, lazy.map(m => `${m.key}: ${m.definition}`));
  const dup = metrics.filter(m => m.definition.toLowerCase().trim() === m.label.toLowerCase().trim() + ".");
  ok("…none is the label with a full stop on it", dup.length === 0, dup.map(m => m.key));

  // The two 0.6 decided about.
  ok("\"stewardship debt\" appears on NO dashboard — it became a defined count",
     !metrics.some(m => /stewardship\s*debt/i.test(m.key + m.label)), metrics.filter(m => /debt/i.test(m.key)).map(m => m.key));
  ok("\"first-touch delay\" appears on NO dashboard — it measured the import date, not the donor",
     !metrics.some(m => /first.?touch/i.test(m.key + m.label)));
  ok("Gifts not yet thanked carries 0.6's exact definition",
     D.definitionFor("people", "giftsNotYetThanked") === "Gifts received since you started with Steward that have no thank-you logged.",
     D.definitionFor("people", "giftsNotYetThanked"));

  // ── live fixture ─────────────────────────────────────────────────────────
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  // `growth` maps to the TEAM tier; org two stays on `seed` (core) so the
  // plan-flag assertions have both sides.
  for (const [id, name, slug, email, plan] of [[ORG, "Harbour Arts", "b86d", "b86d@test.local", "growth"],
                                               [ORG2, "Other Shop", "b86d2", "b86d2@test.local", "seed"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,created_at)
             VALUES ($1,$2,$3,1,'active',$4, NOW() - INTERVAL '400 days')`, [id, name, slug, plan]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`, ["u_" + id, id, email, hash]);
  }
  // The org started with Steward 100 days ago; two donors were created then.
  await q(`INSERT INTO donors (id,org_id,name,stage,total_giving,gift_count,created_at)
           VALUES ('d_b86d_a',$1,'Margaret Chen','steward',9000,3, NOW() - INTERVAL '100 days'),
                  ('d_b86d_b',$1,'Rob Delaney','steward',1000,2, NOW() - INTERVAL '100 days')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,stage) VALUES ('d_b86d_x',$1,'Other Donor','steward')`, [ORG2]);

  const iso = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  // Two gifts SINCE the start (one thanked, one not) and one BEFORE it, which
  // is history and must not be counted as a thank-you owed.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,acknowledgement_sent)
           VALUES ('g_b86d_1',$1,'d_b86d_a',5000,$2,'cash',false),
                  ('g_b86d_2',$1,'d_b86d_b',1000,$3,'cash',true),
                  ('g_b86d_old',$1,'d_b86d_a',4000,$4,'cash',false)`, [ORG, iso(20), iso(40), iso(300)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_b86d_x',$1,'d_b86d_x',777,$2,'cash')`, [ORG2, iso(10)]);

  const tok = await login("b86d@test.local"), tok2 = await login("b86d2@test.local");

  // ── §2 · four questions, answered ────────────────────────────────────────
  console.log("\n— §2 · each one answers on one screen —");
  const rail = (await api("GET", "/dashboards", tok)).body;
  ok("the rail is the SERVER's list, so it cannot drift from what exists",
     (rail.dashboards || []).map(d => d.key).join(",") === "board,fundraising,people,recurring", rail.dashboards);

  const boards = {};
  for (const k of D.DASHBOARD_KEYS) {
    const r = await api("GET", `/dashboards/${k}`, tok);
    boards[k] = r.body;
    ok(`${k} answers`, r.status === 200 && !!r.body.question, r.body?.error);
    ok(`…${k} carries the definition on EVERY number it returns`,
       r.body.metrics.every(m => typeof m.definition === "string" && m.definition.length > 20),
       r.body.metrics.filter(m => !m.definition).map(m => m.key));
    ok(`…${k} says as of when`, /^\d{4}-\d{2}-\d{2}$/.test(r.body.asOf || ""), r.body.asOf);
  }
  ok("an unknown dashboard is 404, not an empty screen",
     (await api("GET", "/dashboards/nope", tok)).status === 404);

  const board = boards.board;
  const val = (b, k) => b.metrics.find(m => m.key === k)?.value;
  ok("Board counts this year's giving", val(board, "revenueThisYear") === 6000, val(board, "revenueThisYear"));
  ok("…and does not count a gift from before the fiscal year",
     val(board, "revenueThisYear") < 10000, val(board, "revenueThisYear"));
  ok("NO PRIOR YEAR IS NULL, NOT ZERO PER CENT — new money has no denominator",
     val(board, "revenueChangePct") === null, val(board, "revenueChangePct"));
  ok("thin retention is BLANK, not a fabricated rate", val(board, "retentionRate") === null, val(board, "retentionRate"));

  // ── §3 · 0.6 answered ────────────────────────────────────────────────────
  console.log("\n— §3 · gifts not yet thanked —");
  const people = boards.people;
  ok("only gifts since the org started with Steward are counted as owed",
     val(people, "giftsNotYetThanked") === 1, {
       counted: val(people, "giftsNotYetThanked"), stewardStart: people.stewardStart,
       note: "one un-thanked gift inside the window; the 300-day-old one is history",
     });
  ok("…an imported file's history is NOT a pile of thank-yous owed",
     val(people, "giftsNotYetThanked") !== 2, val(people, "giftsNotYetThanked"));
  ok("People names who carries the giving", Array.isArray(val(people, "topDonors")) && val(people, "topDonors").length >= 1,
     val(people, "topDonors"));

  // ── §4 · the PDF equals the screen, in cents ─────────────────────────────
  console.log("\n— §4 · the packet equals the screen —");
  for (const k of ["board", "people"]) {
    const r = await fetch(`${BASE}/dashboards/${k}/pdf`, { headers: { Authorization: "Bearer " + tok } });
    const buf = Buffer.from(await r.arrayBuffer());
    ok(`${k} exports a PDF`, r.status === 200 && buf.slice(0, 4).toString() === "%PDF", { status: r.status });
    const text = pdfText(buf);
    ok(`…${k}'s packet asks the same question the screen does`, text.includes(boards[k].question), text.slice(0, 120));
    // EVERY money figure on the screen appears in the packet, to the cent.
    const moneyMetrics = boards[k].metrics.filter(m => m.kind === "money" && m.value != null);
    const missingMoney = moneyMetrics.filter(m => {
      const s = "$" + (cents(m.value) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return !text.includes(s);
    });
    ok(`…${k}'s money figures are equal to the screen IN CENTS`, missingMoney.length === 0,
       missingMoney.map(m => [m.key, m.value]));
    // And every definition is printed, so the packet explains itself.
    const undef = boards[k].metrics.filter(m => !text.includes(m.definition.slice(0, 40)));
    ok(`…and every number's definition is printed in the footnotes`, undef.length === 0, undef.map(m => m.key));
  }

  // ── §5 · the plan flag ───────────────────────────────────────────────────
  console.log("\n— §5 · a one-ED shop has no funnel —");
  const fundTeam = boards.fundraising;
  ok("a Team org is offered the pipeline", fundTeam.metrics.some(m => m.key === "pipelineFunnel"), fundTeam.metrics.map(m => m.key));
  const fundCore = (await api("GET", "/dashboards/fundraising", tok2)).body;
  ok("a Core org is NOT — an empty funnel teaches them the product is not for them",
     !fundCore.metrics.some(m => m.key === "pipelineFunnel"), fundCore.metrics.map(m => m.key));
  ok("…and the rest of the screen is the same for both",
     fundCore.metrics.filter(m => m.key !== "pipelineFunnel").length === fundTeam.metrics.length - 1);

  // The removals, read off the client source.
  const app = readSource("client/src/App.jsx");
  ok("the tab is Dashboards, plural", /\{id:"board",label:"Dashboards"/.test(app));
  ok("…and renders the four, not the old single board screen", /tab==="board"&&<Dashboards/.test(app));
  // COMMENTS ARE NOT A SCREEN — the note explaining what was removed names it.
  const dashboards = fs.readFileSync(path.join(root, "client/src/components/Dashboards.jsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("no platform-fee marketing on any dashboard — marketing does not live inside the product",
     !/platform fee|donor tip/i.test(dashboards), (dashboards.match(/platform fee|donor tip/gi) || []));
  ok("no Board management module — a board packet is a PDF export, not a module",
     !/board member/i.test(dashboards));
  ok("every rendered figure is accompanied by its definition, reachable by keyboard",
     /tabIndex=\{0\}/.test(dashboards) && /aria-label=\{text\}/.test(dashboards));

  // ── §6 · tenancy ─────────────────────────────────────────────────────────
  console.log("\n— §6 · nothing crosses an org boundary —");
  for (const k of D.DASHBOARD_KEYS) {
    const mine = JSON.stringify((await api("GET", `/dashboards/${k}`, tok)).body);
    const theirs = JSON.stringify((await api("GET", `/dashboards/${k}`, tok2)).body);
    ok(`${k}: org B never sees org A's people or figures`,
       !theirs.includes("Margaret Chen") && !theirs.includes("Rob Delaney") && !mine.includes("Other Donor"),
       theirs.slice(0, 160));
  }
  const otherBoard = (await api("GET", "/dashboards/board", tok2)).body;
  ok("org B's own giving is its own", val(otherBoard, "revenueThisYear") === 777, val(otherBoard, "revenueThisYear"));

  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

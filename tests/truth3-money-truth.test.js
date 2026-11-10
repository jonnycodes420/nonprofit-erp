// tests/truth3-money-truth.test.js — TRUTH-3. EVERY MONEY FIGURE A DONOR OR A
// BOARD SEES IS RIGHT, AND ATLAS DOES ARITHMETIC CORRECTLY.
//
// The QA fleet (7 Nov, W-1107-*) found stored drafts stating stale totals,
// Atlas answering "$0 in 0 gifts" for two people, a $0 soft-credit row
// counted on one screen and not another, Top donors against the Directory,
// near-duplicate funds, a ledger alarm, a grant "Passed" 39 days early, a
// retention label naming the wrong year, an unstated Re-engage order, a
// campaign to nobody reading "Sent", and receipts nobody could list. This
// suite builds each shape in its own org with made-up people and asks the
// real routes:
//   §1 a stored draft re-renders the true figures (body and header); the
//      before-Steward total is in lifetime and is said; the re-render script
//      finds it, --apply stores keys, and a second run finds nothing
//   §2 Atlas: two people summed in code; the right gift count; an ambiguous
//      name asks "Which Walter?" with each lifetime and never merges (no
//      model is called: the question is answered in code)
//   §3 a $0 soft-credit row is never counted: By year, the profile's count
//      figure and the truth check's "gift count agrees"
//   §4 Top donors (lifetime) = the Directory; a sort is numeric
//   §5 a fund merge moves everything, and Undo restores it
//   §6 the ledger's three figures foot to every gift
//   §7 a grant's deadline and award state; the retention label; the
//      Re-engage order; "Sent to 0"
//   §8 Tax Receipts lists every receipt, and says what turning them on does
//
// HOW IT GOES RED (planted, see the PR): the draft header reading the stored
// donors.total_giving turns §1 red.
"use strict";
const bcrypt = require("bcryptjs");
const path = require("path");
const { ok, summary, login, api, q, closeDb, mailTypesOn } = require("./helpers");
const { testNow } = require("./clock");
const orgTime = require("../orgTime");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_truth3_${RUN}`;
const OWNER = `owner-${RUN}@truth3.local`;
const PW = "loadtest1234";

async function reset() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at,legal_name,ein,receipt_address)
           VALUES ($1,'Truth Three Trust',$1,1,'active','team',true,'America/New_York',NOW(),'Truth Three Trust Inc','12-3456780','1 Fixture Way')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync(PW, 10), `u_truth3_${RUN}`, OWNER]);
  await mailTypesOn(ORG);
}

const usd = v => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const gid = tag => `g_t3_${RUN}_${tag}`;
// A module this build adds is absent on main: its checks then fail, not the run.
const tryImport = async rel => { try { return await import(path.join(__dirname, "..", rel)); } catch { return null; } };
const tryRequire = rel => { try { return require(path.join("..", rel)); } catch { return null; } };

(async () => {
  await reset();
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const span = (await api("GET", "/reports/lybunt", tok)).body;
  const cur = span.currentPeriod, prior = span.priorPeriod;
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${RUN}@truth3.invalid`, ...extra });
    ok(`${name} exists`, !!(r.body && r.body.id), r.status + " " + JSON.stringify(r.body).slice(0, 200));
    return r.body.id;
  };
  const gift = async (id, amount, date, extra = {}) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, ...extra });
    ok(`a ${usd(amount)} gift on ${date}`, r.status === 200 || r.status === 201, r.status + " " + JSON.stringify(r.body).slice(0, 200));
    return r.body && (r.body.id || (r.body.gift && r.body.gift.id));
  };
  // A row the gift form refuses ($0, a soft credit) arrives by an import or a webhook. Fixture only.
  const rawGift = (tag, donorId, amount, date, type = "gift", extra = "") =>
    q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name${extra ? ",import_id" : ""})
       VALUES ($1,$2,$3,$4,$5,$6,'system:test','test fixture'${extra ? ",$7" : ""})`, [gid(tag), ORG, donorId, amount, date, type, ...(extra ? [extra] : [])]);
  const recompute = id => api("PUT", `/donors/${id}`, tok, { notes: `touched ${RUN}` });

  // ── §1 · A STORED DRAFT RE-RENDERS ITS FIGURES ──────────────────────────
  // The fleet's three: $12,500 for $21,000; $88,606 for $5,001; $1,300 for an
  // imported stated $37,206. Stored the old way: the number in the words.
  const wren = await person("Wren Fairhollow");
  await gift(wren, 12500, prior.from); await gift(wren, 8500, cur.from);
  const ansel = await person("Ansel Brightwater");
  await gift(ansel, 5001, cur.from);
  const tamsin = await person("Tamsin Oakhurst");
  await gift(tamsin, 1300, cur.from);
  await q(`UPDATE donors SET imported_total = 35906, imported_through = $2, imported_import_id = $3 WHERE id = $1`, [tamsin, orgTime.addDays(prior.from, -400), `imp_t3_${RUN}`]);
  // The stale stored rollup an old seed left behind (the planted defect reads it).
  await q(`UPDATE donors SET total_giving = CASE id WHEN $1 THEN 12500 WHEN $2 THEN 88606 ELSE 1300 END WHERE id = ANY($3::text[])`, [wren, ansel, [wren, ansel, tamsin]]);
  const drafts = [[wren, 12500, 21000], [ansel, 88606, 5001], [tamsin, 1300, 37206]];
  for (const [id, stale] of drafts) {
    await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status)
             VALUES ($1,$2,$3,'threshold_1000',$4,$5,'pending_review')`,
      [`md_t3_${RUN}_${id.slice(-6)}`, ORG, id, `Milestone: ${usd(stale)} lifetime`,
       `Dear friend,\n\nYour giving has now reached ${usd(stale)}, and we thank you. Your gift of $250 in May mattered.\n\nWith gratitude,`]);
  }
  const queue = (await api("GET", "/milestone-drafts", tok)).body || [];
  for (const [id, stale, truth] of drafts) {
    const d = queue.find(x => x.donor_id === id) || {};
    ok(`§1 the stored draft's words say ${usd(truth)}, not ${usd(stale)}`, String(d.body).includes(`has now reached ${usd(truth)}`) && !String(d.body).includes(usd(stale)), d.body);
    ok(`§1 the draft's header (subject) says ${usd(truth)} lifetime`, d.subject === `Milestone: ${usd(truth)} lifetime`, d.subject);
    ok(`§1 the card's lifetime is ${usd(truth)}`, Math.round(Number(d.donor_total_giving) * 100) === truth * 100, d.donor_total_giving);
    ok("§1 a figure about one gift stays as written", String(d.body).includes("Your gift of $250 in May"), d.body);
  }
  const td = queue.find(x => x.donor_id === tamsin) || {};
  ok("§1 the imported before-Steward total is in lifetime, and the header says so",
    Number(td.donor_before_steward) === 35906 && /including \$35,906 before Steward/.test(String(td.lifetime_header)), JSON.stringify({ b: td.donor_before_steward, h: td.lifetime_header }));

  // The re-render script: dry run first (counts only), --apply stores keys with an audit row, a second run finds nothing.
  {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" });
    const client = await pool.connect();
    const S = tryRequire("scripts/ops/truth3-rerender-drafts.js");
    const quiet = () => {};
    if (!S) { ok("§1 the re-render script exists", false, "scripts/ops/truth3-rerender-drafts.js is not on this build"); client.release(); await pool.end(); }
    else try {
      const dry = await S.run({ client, orgId: ORG, log: quiet });
      const mine = dry.orgs.find(o => o.orgId === ORG);
      ok("§1 the script's dry run counts this org's three drafts and writes nothing", !!mine && mine.count === 3 && dry.changed === 0, JSON.stringify(dry.orgs));
      const still = (await q(`SELECT COUNT(*)::int AS n FROM milestone_drafts WHERE org_id=$1 AND body LIKE '%{{total_giving}}%'`, [ORG]))[0].n;
      ok("§1 after the dry run the stored words are unchanged", still === 0, still);
      const app = await S.run({ client, orgId: ORG, apply: true, log: quiet });
      const keyed = (await q(`SELECT COUNT(*)::int AS n FROM milestone_drafts WHERE org_id=$1 AND body LIKE '%{{total_giving}}%' AND subject LIKE '%{{total_giving}}%'`, [ORG]))[0].n;
      const audit = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_path='scripts/ops/truth3-rerender-drafts.js'`, [ORG]))[0].n;
      ok("§1 --apply stores the three drafts with figure keys, with one audit row", app.changed === 3 && keyed === 3 && audit === 1, JSON.stringify({ changed: app.changed, keyed, audit }));
      const again = await S.run({ client, orgId: ORG, log: quiet });
      ok("§1 a second run finds nothing to change", !again.orgs.length, JSON.stringify(again.orgs));
      const after = (await api("GET", "/milestone-drafts", tok)).body || [];
      const w = after.find(x => x.donor_id === wren) || {};
      ok("§1 a keyed draft still opens with the true figure", String(w.body).includes("has now reached $21,000") && w.subject === "Milestone: $21,000 lifetime", w.subject);
      await gift(wren, 1000, cur.from);
      const w2 = ((await api("GET", "/milestone-drafts", tok)).body || []).find(x => x.donor_id === wren) || {};
      ok("§1 a gift after the draft was made moves the figure the next time it opens", String(w2.body).includes("has now reached $22,000"), w2.body);
    } finally { client.release(); await pool.end(); }
  }

  // ── §2 · ATLAS: AMOUNTS AND COUNTS IN CODE ──────────────────────────────
  const marlowe = await person("Marlowe Tidewell");
  await gift(marlowe, 30000, prior.from); await gift(marlowe, 1000, cur.from);
  await rawGift("m0", marlowe, 0, cur.from, "soft_credit");   // never counted
  const renee = await person("Renee Castellan");
  await gift(renee, 10432, cur.from);
  const atlas = async text => {
    const r = await api("POST", "/atlas", tok, { text });
    return r;
  };
  {
    const r = await atlas("how much did Marlowe and Renee give together");
    const lines = JSON.stringify(r.body || {});
    ok("§2 \"Marlowe and Renee together\" is $41,432 across 3 gifts, summed in code",
      /\$41,432 together across 3 gifts/.test(lines) && /Marlowe Tidewell \$31,000 across 2 gifts/.test(lines) && /Renee Castellan \$10,432 across 1 gift/.test(lines), lines.slice(0, 600));
    ok("§2 never \"$0 in 0 gifts\"", !/\$0 in 0 gifts/.test(lines), lines.slice(0, 300));
  }
  {
    const r = await atlas("how much has Marlowe given");
    const lines = JSON.stringify(r.body || {});
    ok("§2 one person's count is the one rule (a $0 soft credit is not a gift)", /Marlowe Tidewell has given \$31,000 across 2 gifts/.test(lines), lines.slice(0, 400));
  }
  {
    const w1 = await person("Walter Pennyworth-Hale"); await gift(w1, 500, cur.from);
    const w2 = await person("Walter Quillfeather"); await gift(w2, 7000, cur.from);
    const r = await atlas("how much has Walter given");
    const qs = (r.body && r.body.request && r.body.request.questions) || [];
    const which = qs.find(x => /^Which Walter\?$/.test(x.sentence));
    ok("§2 an ambiguous name asks \"Which Walter?\"", !!which, JSON.stringify(r.body).slice(0, 400));
    ok("§2 each match says its lifetime", !!which && which.options.some(o => /lifetime \$500/.test(o.detail)) && which.options.some(o => /lifetime \$7,000/.test(o.detail)), which && JSON.stringify(which.options));
    const said = JSON.stringify(r.body || {});
    ok("§2 nothing is summed before she picks (never $7,500)", !/\$7,500/.test(said), said.slice(0, 300));
    if (which && r.body.request && r.body.request.id) {
      const a = await api("POST", `/atlas/${r.body.request.id}/answer`, tok, { answers: { [which.id]: w2 } });
      const s = JSON.stringify(a.body || {});
      ok("§2 her pick answers for that Walter only", /Walter Quillfeather has given \$7,000 across 1 gift/.test(s) && !/\$7,500/.test(s), s.slice(0, 400));
    }
  }

  // ── §3 · ONE RULE FOR COUNTING A GIFT ───────────────────────────────────
  const ida = await person("Ida Marchbank");
  await gift(ida, 400, cur.from); await gift(ida, 600, prior.from);
  await rawGift("i0", ida, 0, prior.from, "soft_credit");
  await rawGift("i1", ida, 0, orgTime.addDays(prior.from, -400), "gift");
  await recompute(ida);
  const by = (await api("GET", `/donors/${ida}/by-year`, tok)).body || {};
  const counted = (by.years || []).reduce((n, y) => n + y.giftCount, 0) + (by.other || []).reduce((n, y) => n + y.giftCount, 0);
  ok("§3 By year counts 2 gifts ($0 rows show, never counted)", counted === 2, JSON.stringify((by.years || []).map(y => [y.label, y.giftCount, y.change])));
  const lying = (by.years || []).filter(y => y.giftCount > 0 && /^no gifts/.test(String(y.change)));
  ok("§3 no year says \"1 gift\" beside \"no gifts yet\"", !lying.length, JSON.stringify(lying));
  const [stored] = await q("SELECT gift_count FROM donors WHERE id=$1", [ida]);
  ok("§3 the person's stored count is the same 2", Number(stored.gift_count) === 2, stored.gift_count);
  const cnt = (await api("GET", `/figures/donor-year?donor=${ida}&measure=count&from=1900-01-01&to=${today}`, tok)).body || {};
  if (cnt && cnt.value !== undefined) ok("§3 the count figure opens 2 rows and says 2", Number(cnt.value) === 2 && Number(cnt.totalRows) === 2, JSON.stringify({ v: cnt.value, n: cnt.totalRows }));
  {
    const r = await assertSurfacesAgree(ORG, { token: tok, label: "§3 gift count agrees", soft: true, skip: ["atlas", "ask", "exports", "drift", "mailCampaigns", "campaignReach", "events", "moveReport", "search", "counts", "units", "finance"] });
    const mine = (r.diffs || []).filter(d => /gift count/.test(d));
    ok("§3 the truth check: gift count agrees for every person", !mine.length, mine.join(" | "));
  }

  // ── §4 · TOP DONORS = THE DIRECTORY, AND A SORT IS NUMERIC ──────────────
  const top = (await api("GET", "/reports/top-donors?scope=lifetime&limit=50", tok)).body || {};
  const dir = (await api("GET", "/donors?limit=200&offset=0&sort=lifetime&dir=desc", tok)).body || {};
  const dirRows = (dir.donors || []).filter(d => Number(d.total_giving) > 0);
  const bad = (top.rows || []).filter(t => { const d = dirRows.find(x => x.id === t.id); return !d || Math.round(Number(d.total_giving) * 100) !== Math.round(t.total * 100) || Number(d.gift_count) !== Number(t.giftCount); });
  ok("§4 Top donors' lifetime and gift count are the Directory's, person by person", (top.rows || []).length > 5 && !bad.length, JSON.stringify(bad.slice(0, 3)));
  ok("§4 Top donors says its period", /^Lifetime:/.test(String(top.periodWords)), top.periodWords);
  const amounts = dirRows.map(d => Number(d.total_giving));
  ok("§4 the Directory's lifetime sort is numeric, largest first", amounts.every((v, i) => i === 0 || amounts[i - 1] >= v), JSON.stringify(amounts.slice(0, 12)));
  {
    const RF = await tryImport("client/src/lib/reportFormat.js");
    const rows = [{ a: "$4,500" }, { a: "$4,821" }, { a: "$12,000" }, { a: "4500.50" }];
    const got = RF.sortRows(rows, { key: "a", dir: "desc" }, (r, k) => RF.sortValue(r[k], "text")).map(r => r.a);
    ok("§4 a report table sorts amounts as numbers ($12,000 > $4,821 > $4,500.50 > $4,500)", JSON.stringify(got) === JSON.stringify(["$12,000", "$4,821", "4500.50", "$4,500"]), JSON.stringify(got));
  }

  // ── §5 · A FUND MERGE MOVES EVERYTHING, AND UNDO RESTORES IT ────────────
  const mkFund = async name => (await api("POST", "/finance/funds", tok, { name })).body.id;
  const general = await mkFund("General Operating");
  const generalDup = await mkFund("General");
  const near = (await api("GET", "/finance/funds/near-duplicates", tok)).body || {};
  ok("§5 \"General\" and \"General Operating\" are named as one fund in two names", (near.groups || []).some(g => g.funds.some(f => f.id === general) && g.funds.some(f => f.id === generalDup)), JSON.stringify(near.groups));
  const fg1 = await gift(ida, 250, cur.from, { fundId: generalDup, fund_id: generalDup });
  await q("UPDATE gifts SET fund_id=$1 WHERE id=$2", [generalDup, fg1]);
  const gp = `gp_t3_${RUN}`;
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,fund_id) VALUES ($1,$2,$3,'Spring page',$4)`, [gp, ORG, `spring-${RUN}`, generalDup]).catch(() => null);
  const before = (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND fund_id=$2)::int AS g, (SELECT COUNT(*) FROM giving_pages WHERE org_id=$1 AND fund_id=$2)::int AS p,
                                  (SELECT COUNT(*) FROM fin_transactions WHERE org_id=$1 AND fund_id=$2)::int AS t`, [ORG, generalDup]))[0];
  const pv = (await api("POST", "/finance/funds/merge/preview", tok, { keeperId: general, mergeIds: [generalDup] })).body || {};
  ok("§5 the preview counts what will move", pv.counts && pv.counts.gifts === before.g && pv.counts.giving_pages === before.p && pv.counts.fin_transactions === before.t && /will move/.test(pv.sentence), JSON.stringify({ pv: pv.counts, before }));
  const mg = await api("POST", "/finance/funds/merge", tok, { keeperId: general, mergeIds: [generalDup] });
  const left = (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND fund_id=$2)::int + (SELECT COUNT(*) FROM giving_pages WHERE org_id=$1 AND fund_id=$2)::int + (SELECT COUNT(*) FROM fin_transactions WHERE org_id=$1 AND fund_id=$2)::int AS n`, [ORG, generalDup]))[0].n;
  const [ret] = await q("SELECT retired_at FROM fin_funds WHERE id=$1", [generalDup]);
  ok("§5 the merge moves every gift, page and ledger row to the keeper, and retires the other", mg.status === 200 && left === 0 && !!ret.retired_at, JSON.stringify({ s: mg.status, left, b: mg.body }));
  const und = await api("POST", `/finance/funds/merge/${mg.body && mg.body.mergeId}/undo`, tok, {});
  const back = (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND fund_id=$2)::int AS g, (SELECT COUNT(*) FROM giving_pages WHERE org_id=$1 AND fund_id=$2)::int AS p,
                                (SELECT COUNT(*) FROM fin_transactions WHERE org_id=$1 AND fund_id=$2)::int AS t`, [ORG, generalDup]))[0];
  const [ret2] = await q("SELECT retired_at FROM fin_funds WHERE id=$1", [generalDup]);
  ok("§5 Undo puts every row back on its own fund, and the fund is live again", und.status === 200 && back.g === before.g && back.p === before.p && back.t === before.t && !ret2.retired_at, JSON.stringify({ s: und.status, back, before }));
  const fq = (await api("POST", "/donors/import-combined", tok, { dryRun: true, fundCheck: true, donors: [{ name: "Fixture Row" }], gifts: [{ fund: "general fund" }, { fund: "Brand New Fund" }] })).body || {};
  ok("§5 an import naming \"general fund\" asks before it makes a fund", (fq.fundQuestions || []).length === 1 && fq.fundQuestions[0].existing && /Is it the same fund\?/.test(fq.fundQuestions[0].sentence), JSON.stringify(fq).slice(0, 300));

  // ── §6 · THE LEDGER'S THREE FIGURES FOOT TO EVERY GIFT ──────────────────
  const hist = await person("Hollis Ashgrove");
  await rawGift("h1", hist, 900, orgTime.addDays(cur.from, -500), "gift", `imp_t3h_${RUN}`);
  await rawGift("h2", hist, 0, cur.from, "gift");
  const fin = (await api("GET", "/finance/summary", tok)).body || {};
  const L = fin.ledgerStatus || {};
  const [all] = await q(`SELECT COUNT(*) FILTER (WHERE g.amount > 0)::int AS n, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS c FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
                          WHERE g.org_id=$1 AND d.deleted_at IS NULL AND LOWER(TRIM(COALESCE(g.type,''))) NOT IN ('soft_credit','soft credit','soft','matching','matching_gift','match','in_honor_credit')`, [ORG]);
  const foot = L.posted && (L.posted.count + L.waiting.count + L.history.count === L.all.count) && (L.posted.cents + L.waiting.cents + L.history.cents === L.all.cents);
  ok("§6 Posted + Waiting + History foot to every gift, in count and cents", !!foot && L.all.cents === Number(all.c) && L.all.count === all.n, JSON.stringify({ L, all }));
  ok("§6 a $0 row is never counted as a gift waiting to post (the one counting rule)", L.waiting && !(L.waiting.count > 0 && L.waiting.cents === 0), JSON.stringify(L.waiting));
  ok("§6 the imported gift from before this year is History only, with its sentence", L.history && L.history.count >= 1 && L.history.cents >= 90000 && /never post/.test(L.history.sentence), JSON.stringify(L.history));
  const fr = (await api("GET", `/finance/funds-detail/rows?fund=${generalDup}`, tok)).body || {};
  ok("§6 a fund's drill-down shows the gifts behind it", (fr.gifts || []).some(g => g.id === fg1) && /name this fund|names this fund/.test(fr.sentence), JSON.stringify({ g: (fr.gifts || []).length, s: fr.sentence }));

  // ── §7 · GRANTS, THE RETENTION LABEL, RE-ENGAGE, "SENT TO 0" ────────────
  {
    const dl = orgTime.addDays(today, 39);
    const gr = `gr_t3_${RUN}`;
    await q(`INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,amount_awarded,created_by,created_by_name) VALUES ($1,$2,'Juniper Bridge Foundation','Arts access',20000,'awarded',$3,20000,'system:test','test fixture')`, [gr, ORG, dl]);
    const D = await tryImport("shared/grantDeadline.js");
    const w = D ? D.deadlineWord(dl, today, { pursuing: false }) : { word: "(no rule on this build)" };
    ok("§7 an awarded grant's deadline 39 days out reads 39d, never Passed", w.word === "39d", JSON.stringify(w));
    const GL = await tryImport("shared/grantAwardLine.js");
    const line = GL ? GL.grantAwardLine({ status: "awarded", amountAwarded: 20000, awardPledgeId: null, received: 0 }) : null;
    ok("§7 an awarded amount is never \"no award recorded\"", !!GL && !!GL.awardState && GL.awardState({ status: "awarded", amountAwarded: 20000 }) === "stated" && !!line && !/no award recorded/i.test(line.text), JSON.stringify(line));
    const dls = (await api("GET", "/grants/deadlines", tok)).body || {};
    // MONEY-4: an awarded grant's application deadline disappears from Deadlines (report deadlines stay).
    ok("§7 Deadlines no longer lists an awarded grant's application deadline", !(dls.milestones || []).some(m => m.grantId === gr && m.dueDate === dl), JSON.stringify((dls.milestones || []).map(m => [m.grantId, m.dueDate])).slice(0, 300));
  }
  {
    const src = require("fs").readFileSync(path.join(__dirname, "..", "server", "reports", "helpers.js"), "utf8");
    const cal = src.slice(src.indexOf('opt("calendar"'), src.indexOf('opt("fiscal"'));
    ok("§7 \"Calendar year\" retention reads the calendar-year window it names", /retention-window", params: calWin/.test(cal) && !/key: "retention", params: \{\}/.test(cal), cal.slice(0, 200));
  }
  {
    const RR = await tryImport("client/src/lib/reengageRank.js");
    const rows = [{ name: "A", total: 900, lastAmount: 50 }, { name: "B", total: 100, lastAmount: 800 }, { name: "C", total: 500, lastAmount: 200 }];
    const byLast = RR ? RR.rankBy(rows, "last_gift").map(r => r.name).join("") : "";
    const byLife = RR ? RR.rankBy(rows, "lifetime").map(r => r.name).join("") : "";
    // The view must read the rule too: its rows sorted by it, and the rule's words beside each rank.
    const view = require("fs").readFileSync(path.join(__dirname, "..", "client", "src", "components", "DonorDirectory.jsx"), "utf8");
    ok("§7 Re-engage ranks by the rule it names, and says it beside the rank", byLast === "BCA" && byLife === "ACB" && RR.rankWords(0, "last_gift") === "#1 by last gift amount"
      && /rankBy\(win==="lost"\?lostList:recentList,rankRule\)/.test(view) && /rankWords\(idx,rankRule\)/.test(view), `${byLast} ${byLife}`);
  }
  {
    const cid = `cmp_t3_${RUN}`;
    await q(`INSERT INTO campaigns (id,org_id,name,type,subject,status,sent_at,recipient_count,created_by,created_by_name) VALUES ($1,$2,'Nobody home','email','Hello','sent',NOW(),0,'system:test','test fixture')`, [cid, ORG]);
    const list = (await api("GET", "/campaigns", tok)).body;
    const c = (Array.isArray(list) ? list : []).find(x => x.id === cid) || {};
    ok("§7 a campaign that reached nobody reads \"Not sent: nobody could receive it\", with why",
      c.delivery && c.delivery.sentence === "Not sent: nobody could receive it" && c.delivery.state === "not_sent" && /Nobody in its audience/.test(c.delivery.why || ""), JSON.stringify(c.delivery));
  }

  // ── §8 · TAX RECEIPTS LISTS EVERY RECEIPT ───────────────────────────────
  {
    await q(`INSERT INTO receipts (id,org_id,donor_id,type,tax_year,receipt_number,amount,deductible_amount,sent_to,created_at,snapshot)
             VALUES ($1,$2,$3,'gift',$4,$5,400,400,'ida@truth3.invalid',NOW(),'{}')`, [`rc_t3_${RUN}`, ORG, ida, Number(cur.from.slice(0, 4)), `T3-${RUN}-1`]).catch(e => console.log("receipt fixture:", e.message));
    const off = (await api("GET", "/receipts", tok)).body || {};
    ok("§8 with receipts off, the page says what turning them on does", off.receiptsEnabled === false && /With receipts on, every online gift/.test(off.whenOff || ""), JSON.stringify(off).slice(0, 200));
    ok("§8 every issued receipt is listed", (off.receipts || []).some(r => r.receipt_number === `T3-${RUN}-1` && r.donor_name === "Ida Marchbank"), String(JSON.stringify(off.receipts)).slice(0, 300));
    const found = (await api("GET", `/receipts?q=marchbank`, tok)).body || {};
    const none = (await api("GET", `/receipts?q=nobody-by-this-name`, tok)).body || {};
    ok("§8 search finds it by name, and finds nothing for a stranger", found.total === 1 && none.total === 0, JSON.stringify({ a: found.total, b: none.total }));
    const v = await api("POST", `/receipts/rc_t3_${RUN}/void`, tok, { reason: "Issued to the wrong household" });
    const after = (await api("GET", "/receipts?status=voided", tok)).body || {};
    ok("§8 Void keeps its note and the list shows it", v.status === 200 && (after.receipts || []).some(r => r.id === `rc_t3_${RUN}` && r.void_reason === "Issued to the wrong household"), String(JSON.stringify(after.receipts)).slice(0, 300));
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* */ } process.exit(1); });

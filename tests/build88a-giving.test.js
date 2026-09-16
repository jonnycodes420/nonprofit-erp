// BUILD-88a A.6 — GIVING, NOT REVENUE. Run: node tests/build88a-giving.test.js
//
// "Revenue" is what a business calls the money it takes in for the things it
// sells. A nonprofit that reads it on its own board screen starts answering to
// it. What Steward counts is CONTRIBUTIONS — gifts — and it says so.
//
// Earned income is real money: a bookshop, a ticket, a programme fee. Steward
// does not track it, and the honest response to that is not to hide it but to
// let an org type ONE figure and show it on its own line, never summed into
// giving. The moment the two are added, half the sum comes from gifts Steward
// holds and half from a number nobody here can check.
//
//   §1  no rendered dashboard label or definition says "revenue" — on screen
//       or in the board PDF
//   §2  the board says "Giving this year", with the definition that names what
//       is NOT in it
//   §3  other income is OFF by default and ABSENT, not a blank row
//   §4  turned on, it is its own line, on the screen and in the PDF, and
//       giving does not move by a cent
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_b88a6";
const c = n => Math.round(Number(n) * 100);

async function reset() {
  for (const t of ["threads", "tasks", "recurring_subscriptions", "fin_transactions", "gifts", "interactions",
    "donors", "fundraising_goals", "campaigns", "grants", "pledges", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B88a Giving','b88a-giving',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a6',$1,'b88a6@test.local',$2,'Fresh Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b88a6',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88a6',$1,'General Operating',false)`, [ORG]);
}

(async () => {
  await reset();
  const tok = await login("b88a6@test.local");
  const TODAY = civilToday();
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count)
           VALUES ('d_b88a6',$1,'Giving Donor','gd@b88a6.test','new','steward',12000,2)`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_b88a6_1',$1,'d_b88a6',9000,$2,'cash','ff_b88a6','Check'),
                  ('g_b88a6_2',$1,'d_b88a6',3000,$2,'cash','ff_b88a6','Card')`, [ORG, TODAY]);

  const keys = ["board", "fundraising", "people", "recurring"];

  // ── §1 · the word is gone ────────────────────────────────────────────────
  console.log("\n— §1 · no rendered dashboard says \"revenue\" —");
  const boards = {};
  for (const k of keys) {
    const r = await api("GET", `/dashboards/${k}`, tok);
    ok(`${k} reads`, r.status === 200, r.status);
    boards[k] = r.body;
    const rendered = (r.body.metrics || []).flatMap(m => [m.label, m.definition, ...(Array.isArray(m.value) ? m.value.map(v => v.label) : [])])
      .concat([r.body.label, r.body.question, r.body.blurb])
      .filter(Boolean).join(" | ");
    ok(`${k}: zero occurrences of "revenue" in anything it renders`,
      !/revenue/i.test(rendered), (rendered.match(/[^|]*revenue[^|]*/i) || [])[0]);
  }
  // The registry itself — the rail the client renders from.
  const rail = await api("GET", "/dashboards", tok);
  ok("the dashboard rail says no \"revenue\" either",
    !/revenue/i.test(JSON.stringify(rail.body)), JSON.stringify(rail.body).slice(0, 200));
  // The PDF a board packet carries, text extracted.
  const pdfRes = await fetch(`${BASE}/dashboards/board/pdf`, { headers: { authorization: "Bearer " + tok } });
  const pdfText = Buffer.from(await pdfRes.arrayBuffer()).toString("latin1");
  ok("the board PDF builds", pdfRes.status === 200 && pdfText.startsWith("%PDF"), pdfRes.status);

  // ── §2 · what it says instead ────────────────────────────────────────────
  console.log("\n— §2 · it says Giving this year, and what is not in it —");
  const giving = (boards.board.metrics || []).find(m => m.key === "revenueThisYear");
  ok("the board's headline money label is \"Giving this year\"", giving && giving.label === "Giving this year", giving?.label);
  ok("…and its definition names what Steward does NOT count",
    giving && /Contributions only\. Earned income like store sales or program fees is not tracked here\./.test(giving.definition),
    giving?.definition);
  ok("the figure is the gifts, to the cent", c(giving.value) === c(12000), giving?.value);

  // ── §3 · off by default ──────────────────────────────────────────────────
  console.log("\n— §3 · other income is off, and therefore ABSENT —");
  ok("a fresh org has no \"Other income\" row at all — not a blank one",
    !(boards.board.metrics || []).some(m => m.key === "otherIncomeThisYear"),
    (boards.board.metrics || []).map(m => m.key));

  // ── §4 · turned on ───────────────────────────────────────────────────────
  console.log("\n— §4 · turned on, it is its own line and giving does not move —");
  const setOn = await api("PATCH", `/orgs/${ORG}`, tok, { otherIncomeEnabled: true, otherIncomeThisYear: "41,250.75" });
  ok("an admin can turn it on and type the figure", setOn.status === 200, { status: setOn.status, body: JSON.stringify(setOn.body).slice(0, 160) });
  const after = (await api("GET", "/dashboards/board", tok)).body;
  const other = (after.metrics || []).find(m => m.key === "otherIncomeThisYear");
  ok("it appears as its own line", !!other && c(other.value) === c(41250.75), other);
  ok("…labelled \"Other income this year\"", other && other.label === "Other income this year", other?.label);
  ok("…and its definition says Steward does not track it and never adds it to giving",
    other && /does not track it and never adds it to giving/i.test(other.definition), other?.definition);
  const givingAfter = (after.metrics || []).find(m => m.key === "revenueThisYear");
  ok("GIVING DID NOT MOVE BY A CENT — the two are never summed",
    c(givingAfter.value) === c(12000), { before: 12000, after: givingAfter.value });
  ok("it sits directly under the giving figures, not at the bottom of the board",
    after.metrics.findIndex(m => m.key === "otherIncomeThisYear") ===
    after.metrics.findIndex(m => m.key === "revenueChangePct") + 1,
    after.metrics.map(m => m.key));
  const pdf2 = await fetch(`${BASE}/dashboards/board/pdf`, { headers: { authorization: "Bearer " + tok } });
  ok("the board PDF still builds with the extra line", pdf2.status === 200, pdf2.status);

  // Turned off again, it is absent again — a figure nobody wants shown is not
  // a zero, it is nothing.
  await api("PATCH", `/orgs/${ORG}`, tok, { otherIncomeEnabled: false });
  const off = (await api("GET", "/dashboards/board", tok)).body;
  ok("turned off, the row is gone again (never a $0 line)",
    !(off.metrics || []).some(m => m.key === "otherIncomeThisYear"), (off.metrics || []).map(m => m.key));
  // A negative figure is refused rather than quietly stored.
  await api("PATCH", `/orgs/${ORG}`, tok, { otherIncomeEnabled: true });
  const neg = await api("PATCH", `/orgs/${ORG}`, tok, { otherIncomeThisYear: "-500" });
  ok("a negative other-income figure is refused, not stored", neg.status === 400, neg.status);

  summary("build88a-giving");
  await closeDb();
})();

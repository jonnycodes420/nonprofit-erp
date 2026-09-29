// tests/intpos-sale-is-not-a-gift.test.js — INT-POS. THE ONE GUARD THIS BUILD EARNED.
//
//     A SQUARE SALE MAPPED AS AN EVENT OR A SHOP ITEM NEVER BECOMES A GIFT
//     AND NEVER APPEARS ON A GIVING RECEIPT.
//
// This is the whole build in one sentence, and the failure it prevents is not
// cosmetic. A $45 lesson fee imported as a charitable gift lands on somebody's
// lifetime giving, moves their Drift badge, changes the org's retention rate,
// and at year end can reach a document that tells the IRS a person donated
// money they spent on a lesson. That is a letter from a donor's accountant,
// and it is the messy-money class BUILD-80 spent a whole build on.
//
// WHAT IS ASSERTED, on one gala-night sale carrying all four kinds of line:
//   §1  only the DONATION line becomes a gift, in cents
//   §2  the donor's lifetime giving moves by the donation and nothing else
//   §3  the event and shop money is on the event's report as REVENUE
//   §4  the receipt path sees the donation and nothing else
//   §5  an UNMAPPED item defaults to revenue, never to a gift
//   §6  a buyer with no match becomes a GUEST, never a donor
//   §7  the same sale read twice writes one of everything
//
// HOW IT WOULD GO RED: flip DEFAULT_CLASS to donation; make becomesGift() true
// for event or other; hand the whole sale total to recordGift instead of the
// donation lines; or let an unmatched buyer be typed donor. Each turns a
// different section red. Verified by flipping DEFAULT_CLASS, which turns §5
// and §1 red together.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_pos1";
const ADMIN = "pos1-admin@example.org";
const EVENT = "ev_pos1_gala";
const BUYER = "d_pos1_buyer";

// One gala-night sale: a paddle-raise donation, a raffle ticket, a drink from
// the bar, and a tin of something nobody has ever classified.
const SALE = {
  externalId: "sq_pos1_night_1",
  occurredAt: "2026-05-09",
  locationName: "Harbor Center",
  feeCents: 261,
  buyer: { name: "Perpetua Callowfield", email: "perpetua.callowfield@pos1.test" },
  lines: [
    { name: "Donate $10", amountCents: 10000 },
    { name: "Raffle ticket", amountCents: 2500 },
    { name: "Bar", amountCents: 1800 },
    { name: "Mystery tin", amountCents: 700 },
  ],
};

async function reset() {
  for (const t of ["pos_sales", "pos_item_mappings", "receipts", "thank_you_drafts", "threads",
                   "interactions", "tasks", "notification_sends", "fin_transactions", "fin_audit_log",
                   "gifts", "event_attendees", "event_levels", "events", "donors",
                   "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipts_enabled,legal_name,ein,receipt_address)
           VALUES ($1,'POS One Trust','pos-one',1,'active','team',true,'POS One Legal','12-3456789','1 Harbor St')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_pos1',$1,$2,$3,'POS Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status) VALUES ($1,$2,'Harbor Gala','gala','2026-05-09','completed')`,
    [EVENT, ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,total_giving,gift_count)
           VALUES ($1,$2,'Perpetua Callowfield',$3,'steward','active','[]',0,0)`,
    [BUYER, ORG, SALE.buyer.email]);
}

const totals = async id => {
  const [d] = await q(`SELECT total_giving::float AS total, gift_count FROM donors WHERE id=$1`, [id]);
  const [g] = await q(`SELECT COALESCE(SUM(amount),0)::float AS s, COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]);
  return { rollup: Number(d?.total || 0), giftCount: Number(d?.gift_count || 0),
           gifts: Number(g?.s || 0), giftRows: g?.n || 0 };
};

(async () => {
  console.log("INT-POS — a sale is not a gift\n");
  await reset();
  const tok = await login(ADMIN);

  // THE MAPPING, set the way an organisation sets it: once, on a screen.
  const map = await api("PUT", "/pos/mapping", tok, { items: [
    { itemName: "Donate $10", class: "donation" },
    { itemName: "Raffle ticket", class: "event", eventId: EVENT },
    { itemName: "Bar", class: "event", eventId: EVENT },
    // "Mystery tin" is deliberately left out. §5 is about it.
  ] });
  ok("the mapping saves", map.status === 200 && map.body?.saved === 3, map.body);

  const before = await totals(BUYER);
  const sale = await api("POST", "/pos/sales", tok, { sale: SALE, today: "2026-05-09" });
  ok("the sale is read", sale.status === 200 && sale.body?.ok === true, sale.body);

  // ── §1 · ONLY THE DONATION BECOMES A GIFT ───────────────────────────────
  ok("§1 the donation line, and only it, became money given",
     sale.body?.giftCents === 10000, sale.body);
  ok("§1 the raffle and the bar are event revenue, not gifts",
     sale.body?.eventCents === 4300, sale.body);
  ok("§1 the unclassified tin is revenue too", sale.body?.otherCents === 700, sale.body);
  const giftRows = await q(`SELECT amount::float AS a, external_id FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§1 exactly ONE gift row exists for a four-line sale", giftRows.length === 1, giftRows);
  ok("§1 …and it is $100, not the $190 that crossed the counter",
     giftRows[0] && Number(giftRows[0].a) === 100, giftRows[0]);

  // ── §2 · THE PERSON'S RECORD MOVED BY THE GIFT AND NOTHING ELSE ─────────
  const after = await totals(BUYER);
  ok("§2 lifetime giving moved by exactly the donation",
     Math.round((after.rollup - before.rollup) * 100) === 10000, { before, after });
  ok("§2 …and by one gift, not four", after.giftCount - before.giftCount === 1, { before, after });

  // ── §3 · THE MONEY THAT IS NOT A GIFT IS ON THE EVENT'S REPORT ─────────
  const ev = await api("GET", `/pos/event/${EVENT}/revenue`, tok);
  ok("§3 the event's report carries the register's takings",
     ev.status === 200 && ev.body?.eventRevenueCents === 4300, ev.body);
  ok("§3 …and shows the gift separately rather than inside the revenue",
     ev.body?.giftsAtRegisterCents === 10000, ev.body);

  // ── §4 · THE RECEIPT SEES THE DONATION AND NOTHING ELSE ────────────────
  // The receipt path reads GIFTS. The assertion is that the money it can
  // possibly reach is the donation: there is no gift row for the raffle, the
  // bar or the tin, so no receipt can name them however it is generated.
  const [recAble] = await q(
    `SELECT COALESCE(SUM(amount),0)::float AS s FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, BUYER]);
  ok("§4 the only money a giving receipt could ever name is the $100",
     Number(recAble.s) === 100, recAble);
  const POS = await import("../shared/posItems.js");
  ok("§4 …and the classifier says so directly, for each class",
     POS.mayAppearOnGivingReceipt("donation") === true
       && POS.mayAppearOnGivingReceipt("event") === false
       && POS.mayAppearOnGivingReceipt("other") === false);

  // ── §5 · UNMAPPED DEFAULTS TO REVENUE, NEVER TO A GIFT ─────────────────
  ok("§5 the unmapped tin was counted, and counted as revenue",
     sale.body?.unmapped === 1 && sale.body?.otherCents === 700, sale.body);
  ok("§5 …because the default class is the one that cannot become a gift",
     POS.DEFAULT_CLASS === "other" && POS.becomesGift(POS.DEFAULT_CLASS) === false, POS.DEFAULT_CLASS);

  // ── §6 · A STRANGER AT THE TILL IS A GUEST, NEVER A DONOR ──────────────
  const stranger = await api("POST", "/pos/sales", tok, { today: "2026-05-09", sale: {
    externalId: "sq_pos1_night_2", occurredAt: "2026-05-09", locationName: "Harbor Center",
    buyer: { name: "Wilhelmina Torrance", email: "wilhelmina.torrance@pos1.test" },
    lines: [{ name: "Bar", amountCents: 1200 }] } });
  ok("§6 a buyer nobody knows is read", stranger.status === 200 && stranger.body?.ok, stranger.body);
  const [guest] = await q(
    `SELECT id, person_types, total_giving::float AS total FROM donors WHERE org_id=$1 AND LOWER(email)=$2`,
    [ORG, "wilhelmina.torrance@pos1.test"]);
  const types = Array.isArray(guest?.person_types) ? guest.person_types
    : (() => { try { return JSON.parse(guest?.person_types || "[]"); } catch { return []; } })();
  ok("§6 …and becomes a person typed GUEST", types.includes("guest"), types);
  ok("§6 …never a donor, because they have not given a penny",
     !types.includes("donor") && Number(guest.total) === 0, { types, total: guest?.total });

  // ── §7 · THE SAME NIGHT READ TWICE ─────────────────────────────────────
  const again = await api("POST", "/pos/sales", tok, { sale: SALE, today: "2026-05-09" });
  ok("§7 the same sale read again is recognised, not rewritten",
     again.status === 200 && again.body?.duplicate === true, again.body);
  const [salesN] = await q(`SELECT COUNT(*)::int AS n FROM pos_sales WHERE org_id=$1`, [ORG]);
  const [giftsN] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§7 …so there are two sales and one gift, not three and two",
     Number(salesN.n) === 2 && Number(giftsN.n) === 1, { sales: salesN.n, gifts: giftsN.n });

  // ── AND THE SIGNAL THE BUILD EXISTS FOR ────────────────────────────────
  const never = await api("GET", "/pos/buys-never-given", tok);
  ok("the guest who bought and has never given is on the list",
     never.status === 200 && (never.body?.rows || []).some(r => r.id === guest.id), never.body);
  ok("…and the donor who DID give is not on it",
     !(never.body?.rows || []).some(r => r.id === BUYER), never.body?.rows);

  // Tidy up: the same teardown reset() does, without re-creating the fixture.
  for (const t of ["pos_sales", "pos_item_mappings", "receipts", "thank_you_drafts", "threads",
                   "interactions", "tasks", "notification_sends", "fin_transactions", "fin_audit_log",
                   "gifts", "event_attendees", "event_levels", "events", "donors",
                   "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

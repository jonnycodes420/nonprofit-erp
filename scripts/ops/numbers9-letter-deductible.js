#!/usr/bin/env node
// NUMBERS-9 item 2 · LETTERS ALREADY MARKED SENT WHOSE PRINTED DEDUCTIBLE WAS ONE GIFT'S, NOT THE TOTAL.
//
// W-1126-Donors-T3: a letter covering two or more gifts, one of which bought something (a gala
// seat), printed one deductible figure: the disclosure under that one gift ("the deductible amount
// is $310"), with nothing adding the gifts up, while the letters list said the total ($410). The
// letter text is not stored. What is stored is the mark "Mark these as sent" leaves on each gift
// (acknowledged_via = 'letter', acknowledgement_sent_at), so a letter is rebuilt as one person's
// gifts marked by letter on one day. A letter is listed when it covered more than one gift, exactly
// one of them had a fair market value (so its one disclosure read like the letter's figure), and
// that gift's deductible is not the total across the letter (shared/numbers/deductible.js).
//
// It prints org id, a letter id (person id and the day it was marked) and the two figures. No names,
// no addresses. Jonathan decides what to tell anyone who received one.
//
// READ ONLY: one READ ONLY session, no --apply, it writes nothing.
//
//   DATABASE_URL=… node scripts/ops/numbers9-letter-deductible.js org_x     # one org
//   DATABASE_URL=… node scripts/ops/numbers9-letter-deductible.js           # every org
"use strict";
const { Pool } = require("pg");
const D = require("../../shared/numbers/deductible");

const usd = c => "$" + (c / 100).toFixed(2);

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const only = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const pool = new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await pool.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const { rows } = await pool.query(
      `SELECT g.org_id, g.donor_id, LEFT(g.acknowledgement_sent_at::text, 10) AS day, g.id, g.date,
              g.amount::text AS amount, g.deductible_amount::text AS deductible_amount, g.quid_pro_quo_value::text AS quid_pro_quo_value
         FROM gifts g
        WHERE g.acknowledged_via = 'letter' AND g.acknowledgement_sent_at IS NOT NULL AND g.amount > 0
          AND COALESCE(g.is_sample, false) = false AND ($1::text IS NULL OR g.org_id = $1)
        ORDER BY g.org_id, g.donor_id, day, g.date`, [only]);
    const letters = new Map();
    for (const r of rows) {
      const k = `${r.org_id}|${r.donor_id}|${r.day}`;
      if (!letters.has(k)) letters.set(k, []);
      letters.get(k).push(r);
    }
    let listed = 0, looked = 0;
    console.log("org_id\tletter_id\tgifts\tprinted_deductible\ttotal_deductible\tdifference");
    for (const [k, gifts] of letters) {
      if (gifts.length < 2) continue;
      looked++;
      const withValue = gifts.filter(g => Number(g.quid_pro_quo_value || 0) > 0);
      if (withValue.length !== 1) continue;
      const printed = D.giftDeductibleCents(withValue[0]);
      const total = D.deductibleAcross(gifts).deductibleCents;
      if (printed === total) continue;
      listed++;
      const [org, donor, day] = k.split("|");
      console.log(`${org}\t${donor}:${day}\t${gifts.length}\t${usd(printed)}\t${usd(total)}\t${usd(total - printed)}`);
    }
    console.log(`\n${listed} ${listed === 1 ? "letter" : "letters"} printed one gift's deductible as the only figure, of ${looked} letters marked sent that covered more than one gift.`);
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });

// scripts/seed/home2-days.js · HOME-2. WHAT LEADS HARBORLIGHT'S HOME TODAY.
//
// Home's lead slot shows what matters most today (shared/homeLead.js). The
// demo carries the three situations from the approved mockups, dated around
// the day it is seeded, so Home shows them live:
//
//   · Dana's lunch with Ansel Pendlebury at Windy Corner, today at noon (the
//     CAL-1 week block booked it earlier in the week; it moves to today);
//   · Halvorsen Family Foundation's $7,500 gift arriving at 9:42 last night,
//     not thanked yet, with its thank-you drafted for her yes (PROSPECT-1's
//     foundation already gave $5,000 a year before; its $7,500 moves from a
//     month ago to last night, so no total changes);
//   · Priya's own coffee this afternoon with the largest donor in her
//     portfolio, so the officer's Home leads with her day, not Dana's.
//
// What was already here and is not touched: five money cards in To confirm
// (CAPTURE-1), the year-end campaign with its $60,000 goal (CAMPAIGN-2), and
// the people who gave last December and not since. Mid-November, the year-end
// card leads on its own.
//
// Idempotent: the rows it adds start `h2_b72_`; the two it moves are moved again.
"use strict";

async function seedHome2(q, ORG, { TODAY, TZ, orgTime, draftMod }) {
  const at = (day, hhmm) => orgTime.localToInstant(`${day}T${hhmm}`, TZ).toISOString();
  await q(`DELETE FROM thank_you_drafts WHERE org_id=$1 AND id LIKE 'h2_b72_%'`, [ORG]);
  await q(`DELETE FROM calendar_events WHERE org_id=$1 AND id LIKE 'h2_b72_%'`, [ORG]);

  // ── The lunch, today at noon.
  const [ansel] = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND name='Ansel Pendlebury' AND deleted_at IS NULL`, [ORG]);
  if (!ansel) throw new Error("home2 seed: Ansel Pendlebury is not in the demo");
  const [lunch] = await q(`SELECT id FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids) AND title ILIKE 'Lunch%' ORDER BY starts_at DESC LIMIT 1`, [ORG, ansel.id]);
  if (lunch) await q(`UPDATE calendar_events SET starts_at=$1, ends_at=$2, location='Windy Corner', dismissed_at=NULL, logged_at=NULL WHERE id=$3 AND org_id=$4`,
    [at(TODAY, "12:00"), at(TODAY, "13:00"), lunch.id, ORG]);
  else await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by,created_by_name)
                VALUES ('h2_b72_lunch',$1,'u_b72demo','google','h2_b72_lunch','Lunch with Ansel Pendlebury',$2,$3,'Windy Corner',$4,'system:calendar/google/u_b72demo','Calendar sync')`,
    [ORG, at(TODAY, "12:00"), at(TODAY, "13:00"), [ansel.id]]);

  // ── The $7,500 gift, last night at 9:42.
  const [fdn] = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND name='Halvorsen Family Foundation' AND deleted_at IS NULL`, [ORG]);
  if (!fdn) throw new Error("home2 seed: Halvorsen Family Foundation is not in the demo");
  const [g] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND amount=7500 ORDER BY date DESC LIMIT 1`, [ORG, fdn.id]);
  if (!g) throw new Error("home2 seed: the Halvorsen $7,500 gift is not in the demo");
  const yesterday = orgTime.addDays(TODAY, -1), arrived = at(yesterday, "21:42");
  // It came in through the giving page overnight, so the webhook wrote it.
  await q(`UPDATE gifts SET date=$1, received_at=$2, created_at=$2, acknowledgement_sent=false, thanked_at=NULL, import_id=NULL,
                          payment_method='Card', created_by='system:stripe-webhook', created_by_name='Stripe' WHERE id=$3 AND org_id=$4`,
    [yesterday, arrived, g.id, ORG]);
  await q(`UPDATE donors SET last_gift_date=$1, last_gift_amount=7500 WHERE id=$2 AND org_id=$3`, [yesterday, fdn.id, ORG]);
  const t = draftMod.thankYouDraft({ donorName: fdn.name, giftCents: 750000, fundName: "Scholarship Fund", orgName: "Harborlight Youth Collective",
    voice: { ready: false }, giftCountBefore: 1, isFirstGift: false, isRecurring: false, monthsSinceLastGift: 13, campaignName: null,
    person: { kind: "organisation" } });
  await q(`DELETE FROM thank_you_drafts WHERE org_id=$1 AND gift_id=$2`, [ORG, g.id]);
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice) VALUES ('h2_b72_halvorsen',$1,$2,$3,$4,$5)`, [ORG, fdn.id, g.id, t.body, t.voice]);

  // ── Priya's own coffee this afternoon.
  const [mine] = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND assigned_to='u_b72demo_off' AND deleted_at IS NULL AND COALESCE(deceased,false)=false
                           AND kind IS DISTINCT FROM 'organisation' ORDER BY total_giving DESC, id LIMIT 1`, [ORG]);
  if (mine) await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by,created_by_name)
                     VALUES ('h2_b72_priya',$1,'u_b72demo_off','google','h2_b72_priya',$2,$3,$4,'Magee''s on Main',$5,'system:calendar/google/u_b72demo_off','Calendar sync')`,
    [ORG, `Coffee with ${mine.name}`, at(TODAY, "15:30"), at(TODAY, "16:15"), [mine.id]]);

  const [{ n: waiting }] = await q(`SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=$1 AND status='waiting' AND stakes='money'`, [ORG]);
  console.log(`[seed] HOME-2: lunch with ${ansel.name} today at noon, ${fdn.name}'s $7,500 last night with its thank-you drafted, ${waiting} gifts in To confirm${mine ? `, Priya's coffee with ${mine.name}` : ""}`);
}

module.exports = { seedHome2 };

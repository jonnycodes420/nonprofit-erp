// personData.js — TRUST-2 Part 4. ONE PERSON'S DATA: EXPORT IT, OR ERASE IT.
//
// A donor writes and asks what you hold about them, or asks you to forget
// them. Both answers come from here, so "everything about this person" is one
// list, kept in one place, rather than two lists that drift apart.
//
// ERASE KEEPS THE MONEY AND LOSES THE PERSON. Every gift, pledge, receipt and
// ledger line stays, with its amount, date and fund, attached to a record now
// called "Erased person" with nothing else on it. That is what keeps the books,
// the receipts already issued and every total footing to the cent. What goes:
// the name, every contact detail, notes, tags, custom fields, the photo, every
// logged email, meeting and conversation, drafts, tasks and every free-text
// field that could name them, here and in the copies of their name the money
// record keeps (the ledger description, the receipt snapshot and its PDF, the
// cheque photo).
//
// WHAT IS KEPT, AND SAID SO ON THE PRIVACY PAGE:
//   · their address on the do-not-email list, if they asked not to be mailed,
//     so they are never mailed again by accident
//   · the audit history, which is append-only by design; it records that the
//     erasure happened, and never what was erased
//
// Everything runs in ONE transaction. A table that does not exist on an older
// database is skipped; any other failure undoes the whole erasure.
"use strict";
const { query, withTransaction } = require("./db");

const ERASED_NAME = "Erased person";

// The donors columns that describe the person. Set to NULL, except the few
// with NOT NULL or JSON shapes, which get an empty value.
const DONOR_PII_NULL = ["email", "email2", "phone", "mobile", "address", "address2", "city", "state", "zip", "country",
  "notes", "employer", "middle_name", "suffix", "salutation", "spouse_name", "contact_name", "latitude", "longitude",
  "geocode_key", "geocoded_at", "geocode_status", "geocode_provider", "photo_asset_id", "photo_source_url",
  "photo_fetch_status", "photo_fetch_error", "score_rationale", "wealth_screen_source", "wealth_screen_rating",
  "wealth_screen_capacity", "wealth_screen_date", "deceased_date", "funder_ein", "external_donor_id",
  "external_household_id", "email_unreachable_reason"];

// Rows that are about the person and nothing else: removed.
const DELETE_BY_DONOR = ["interactions", "threads", "thank_you_drafts", "milestone_drafts", "agent_drafts", "note_reminders",
  "moves", "custom_field_values", "donor_materials", "campaign_recipients", "email_marketing_activity", "tasks",
  "tribute_notices", "opportunities", "planned_gifts", "donor_designations", "cultivation_plans", "reconnect_sends",
  "sequence_enrollments", "sequence_sends", "gift_duplicate_questions", "import_merges", "donor_account_links",
  "portal_audit_log"];

async function exportPerson(orgId, donorId) {
  const one = async (sql, args) => { try { return await query(sql, args); } catch (e) { if (/does not exist/.test(e.message)) return []; throw e; } };
  const [donor] = await one(`SELECT * FROM donors WHERE id=? AND org_id=?`, [donorId, orgId]);
  if (!donor) return null;
  const strip = r => { const o = { ...r }; delete o.org_id; return o; };
  const out = {
    exportedAt: new Date().toISOString(),
    about: "Everything this organisation's Steward holds about one person. Gifts and money records are included with their amounts; staff-only scoring fields are included because they are about this person.",
    profile: strip(donor),
    gifts: (await one(`SELECT g.id, g.date, g.amount, g.type, g.payment_method, f.name AS fund, g.notes, g.tribute_name, g.campaign
                         FROM gifts g LEFT JOIN fin_funds f ON f.id=g.fund_id WHERE g.org_id=? AND g.donor_id=? ORDER BY g.date`, [orgId, donorId])),
    pledges: await one(`SELECT id, amount, due_date, status, notes FROM pledges WHERE org_id=? AND donor_id=?`, [orgId, donorId]),
    receipts: await one(`SELECT id, created_at, sent_to, snapshot FROM receipts WHERE org_id=? AND donor_id=?`, [orgId, donorId]),
    notesEmailsAndMeetingsLogged: await one(`SELECT id, type, date, note, metadata FROM interactions WHERE org_id=? AND donor_id=? ORDER BY date`, [orgId, donorId]),
    meetingsFromCalendars: await one(`SELECT id, title, starts_at, ends_at, location, note FROM calendar_events WHERE org_id=? AND ?=ANY(person_ids)`, [orgId, donorId]),
    events: await one(`SELECT a.id, e.name AS event, a.name, a.email, a.dietary, a.notes, a.created_at FROM event_attendees a
                         LEFT JOIN events e ON e.id=a.event_id WHERE a.org_id=? AND a.donor_id=?`, [orgId, donorId]),
    volunteerHours: await one(`SELECT id, date, hours, note FROM volunteer_shifts WHERE org_id=? AND person_id=?`, [orgId, donorId]),
    customFields: await one(`SELECT field_id, value FROM custom_field_values WHERE org_id=? AND donor_id=?`, [orgId, donorId]),
    relationships: await one(`SELECT id, donor_id_a, donor_id_b, relationship, notes FROM donor_relationships WHERE org_id=? AND (donor_id_a=? OR donor_id_b=?)`, [orgId, donorId, donorId]),
    optOuts: {
      flags: { do_not_contact: donor.do_not_contact, do_not_solicit: donor.do_not_solicit, do_not_mail: donor.do_not_mail, do_not_email: donor.do_not_email },
      emailSuppressions: donor.email ? await one(`SELECT email, reason, created_at FROM email_suppressions WHERE org_id=? AND lower(email)=lower(?)`, [orgId, donor.email]) : [],
    },
  };
  return out;
}

async function erasePerson(orgId, donorId) {
  return withTransaction(async client => {
    let n = 0;
    const step = async (sql, args) => {
      await client.query("SAVEPOINT s");
      try { const r = await client.query(sql, args); await client.query("RELEASE SAVEPOINT s"); n += r.rowCount || 0; return r; }
      catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT s");
        if (e.code === "42P01" || e.code === "42703") return { rows: [], rowCount: 0 };   // table or column not on this database
        throw e;
      }
    };
    const { rows: [d] } = await client.query(`SELECT id, email, email2, name FROM donors WHERE id=$1 AND org_id=$2 FOR UPDATE`, [donorId, orgId]);
    if (!d) return null;
    const emails = [d.email, d.email2].filter(Boolean).map(e => String(e).toLowerCase());

    // The money record: kept, with every copy of the name taken out.
    await step(`UPDATE gifts SET notes=NULL, tribute_name=NULL, quid_pro_quo_desc=NULL, custom_fields='{}'::jsonb, cheque_asset_id=NULL WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId]);
    await step(`UPDATE gifts SET notes=NULL, custom_fields='{}'::jsonb WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId]);
    await step(`UPDATE fin_transactions SET description='Gift', vendor_donor=$3, notes=NULL WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId, ERASED_NAME]);
    await step(`UPDATE receipts SET sent_to=NULL, pdf_data=NULL,
                  snapshot = CASE WHEN snapshot IS NULL THEN NULL ELSE jsonb_set(snapshot - 'donorAddress' - 'donorEmail', '{donorName}', to_jsonb($3::text)) END
                WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId, ERASED_NAME]);
    await step(`UPDATE pledges SET notes=NULL WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId]);
    await step(`UPDATE pos_sales SET buyer_name=NULL, buyer_email=NULL, buyer_phone=NULL WHERE org_id=$1 AND person_id=$2`, [orgId, donorId]);
    await step(`UPDATE payment_recovery_events SET detail=NULL WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId]);
    await step(`UPDATE event_attendees SET name=$3, email=NULL, notes=NULL, dietary=NULL, recognition=NULL WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId, ERASED_NAME]);
    await step(`UPDATE peer_fundraisers SET name=$3, email='', story=NULL, image_url=NULL WHERE org_id=$1 AND person_id=$2`, [orgId, donorId, ERASED_NAME]);
    await step(`UPDATE volunteer_shifts SET note=NULL WHERE org_id=$1 AND person_id=$2`, [orgId, donorId]);

    // Everything that is only about them: gone.
    for (const t of DELETE_BY_DONOR) await step(`DELETE FROM ${t} WHERE org_id=$1 AND donor_id=$2`, [orgId, donorId]);
    await step(`DELETE FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2)`, [orgId, donorId]);
    for (const t of ["volunteer_notes", "volunteer_signups", "volunteer_group_members", "volunteer_credentials", "volunteer_magic_links", "supporter_links", "supporter_sessions"])
      await step(`DELETE FROM ${t} WHERE org_id=$1 AND person_id=$2`, [orgId, donorId]);
    await step(`DELETE FROM agent_writes WHERE org_id=$1 AND entity_id=$2`, [orgId, donorId]);
    // Meetings: they leave every meeting; a meeting with nobody else in it goes.
    await step(`UPDATE calendar_events SET person_ids=array_remove(person_ids,$2), title='Meeting', note=NULL, next_step=NULL, location=NULL
                WHERE org_id=$1 AND $2=ANY(person_ids) AND cardinality(person_ids) > 1`, [orgId, donorId]);
    await step(`DELETE FROM calendar_events WHERE org_id=$1 AND person_ids=ARRAY[$2]::text[]`, [orgId, donorId]);
    if (emails.length) {
      await step(`DELETE FROM inbound_email_unmatched WHERE org_id=$1 AND lower(from_email) = ANY($2)`, [orgId, emails]);
      await step(`DELETE FROM notification_failures WHERE org_id=$1 AND lower(recipient_email) = ANY($2)`, [orgId, emails]);
    }
    if (d.photo_asset_id) await step(`DELETE FROM portal_assets WHERE org_id=$1 AND id=$2`, [orgId, d.photo_asset_id]);

    // The record itself: a name that says what happened, and nothing else.
    const sets = DONOR_PII_NULL.map((c, i) => `${c}=NULL`).join(", ");
    await step(`UPDATE donors SET ${sets} WHERE org_id=$1 AND id=$2`, [orgId, donorId]);
    await step(`UPDATE donors SET name=$3, tags='[]', custom_fields='{}'::jsonb, external_donor_ids=NULL, erased_at=NOW() WHERE org_id=$1 AND id=$2`,
      [orgId, donorId, ERASED_NAME]);
    return { erased: true, rowsTouched: n };
  });
}

module.exports = { exportPerson, erasePerson, ERASED_NAME };

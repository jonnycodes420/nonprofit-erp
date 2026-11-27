// LIVE-2 · WHICH SCREENS A TABLE'S WRITE REACHES, NAMED ONCE.
//
// The server reads the tables each write request's statements touched
// (server/shared/changedTables.js) and answers them as topics in the
// X-Steward-Changed header. The browser announces those topics (client/src/
// lib/changes.js), and the bell's worker marks (org_changes, per table) are
// mapped by this same list. A topic is one of the browser's KINDS.
//
// SILENT is checked first, then the first matching rule wins. SILENT tables move no figure a person sees (logs,
// sessions, the queue, stored answers derived from watched rows). Every table
// with org_id is named by a rule or by SILENT: tests/tenant-matrix.test.js (tests/lib/changedHeaderGuard.js)
// fails on one that is neither, so a new table is placed on purpose.
// CommonJS (.cjs: shared/ is ES modules): the server requires it, Vite converts it for the browser (client/vite.config.js).
"use strict";

const GIFT = ["gift", "person", "totals", "fund"];
const RULES = [
  // SALES-5: Steward's own sales CRM (/ops → Sales, no org's data): a deal's value, a stage, a quote.
  [/^sales_/, ["sales"]],
  [/^(stored_insights|insight_)/, ["insights"]],
  [/^(imports?|import_|sheet_import_jobs|setup_runs|setup_files|old_report_|screening_imports|statement_mappings|stored_sheets)/, ["import"]],
  [/^(agent_drafts|milestone_drafts|thank_you_drafts|video_thanks|tribute_notices|email_starter_reviews)$/, ["draft", "task"]],
  [/^(pledges?|pledge_|planned_gifts)/, ["pledge", "gift", "person", "totals"]],
  [/^(gifts|gift_|giving_recurring|recurring_|receipts|deposit_marks|capture_|ledger_|fin_transactions|dispute_reversals|payment_recovery_events|offline_recurring_plans|qbo_read_|bookkeeping_deposits|pos_sales|historical_totals|donations|soft_credits|deposits|checks|batches|auto_mail_sent|reconnect_sends)/, GIFT],
  [/^(grants?|grant_|program_grants|funders?|programs)$|^grant_/, ["grant", "pledge", "totals", "task"]],
  [/^(events?|event_|auction|attendee|guest|ticket|table_)/, ["event", "person"]],
  [/^(tasks|note_reminders|call_snoozes|cultivation_|care_|journey_|sequence_enrollments|sequences|plan_steps|moves)$|^(cultivation_|care_|journey_)/, ["task", "person"]],
  [/^(group_|groups$|audiences|segments)/, ["group", "person"]],
  [/^volunteer_notes$/, ["note", "volunteer", "person"]],   // LIVE-2 item 3: a note from the Volunteers hub is a note
  [/^(volunteer|shift|hours)/, ["volunteer", "person"]],
  [/^(funds|fin_funds|fund_merges|campaign_merges|financials|budgets|annual_fund_goals|fundraising_goals|campaigns|appeals|campaign_recipients|impact_metrics|impact_updates)$/, ["fund", "totals"]],
  [/^(interactions|interaction_attachments|threads|notes|voice_memos|inbound_email_drops|inbound_email_unmatched|conversations|meeting_effects|calendar_events|email_log|attachments|donor_materials|survey_responses)$/, ["note", "person"]],
  [/^(donors|donor_|households|relationships|person|deceased_marks|name_fixes|merge_proposals|deleted_records|privacy_holds|custom_field_values|custom_field_events|opportunities|memberships|ncoa_moves|portfolio_|peer_fundraisers|p2p_teams|matching_employers|supporter_links|board_members|screening_results)/, ["person", "totals"]],
  [/^(orgs|users|invites|org_memberships|org_onboarding|org_mail_types|org_touch_types|brand_kits?|portal_settings|portal_pages|giving_pages|giving_page_versions|giving_sources|membership_levels|custom_field_defs|custom_fields|email_templates|email_saved_blocks|message_templates|ack_letter_templates|api_keys|webhook_endpoints|workflows|accounts|surveys)$/, ["org"]],
];
// Writes no screen's figure reads. Prefix matches end in "_".
const SILENT = [
  // ONBOARD-5: her yearly events are listed only on the setup page's Funds step, which re-reads them; no figure reads them.
  /^org_yearly_events$/,
  /^(audit_log|audit_trail|fin_audit_log|portal_audit_log|api_call_log|ai_log|ai_usage|ai_fallbacks|question_log|rate_limit_hits)$/,
  /^(job_queue|events_outbox|org_changes|org_changes_floor|org_summary|donor_drift|number_checks|reengage_snapshots|send_plans|write_effects|smart_move_state|smart_move_sweeps)$/,
  /_sessions$|^(oauth_states|mfa_recovery_codes|portal_magic_links|volunteer_magic_links|start_links|start_signatures|order_signatures|close_links|terms_acceptances|support_tickets)$/,
  /^(client_marks|client_email_removals|donor_list_layouts|donor_list_views|saved_dashboards|saved_reports|saved_report_sends|board_reports|ask_pins|home_lead_dismissals|data_health_|onboard_|metric_snapshots|org_record_months|readouts?|readout_events|form_events|group_sweep_seen|insight_shown)/,
  /^(notification_|digest_sends|board_pack_|mail_|mailbox_|email_suppressions|email_marketing_|gmail_|bookkeeping_connections|bookkeeping_customers|gift_bookkeeping_syncs|calendar_pushes|send_confirms|invite_sends|grant_sends|webhook_deliveries|billing_webhook_events|platform_payments|sample_data_audit|asset_|media_items|portal_assets|pos_item_mappings|public_filings|ncoa_batches|network_applications|donor_org_follows|donor_account_links|agent_instructions|agent_runs|agent_writes|atlas_actions|workflow_runs|workflow_conversions|touch_batches|support_|connection_asks|connection_checks)/,
  /^(audiences_seen|journey_start_skips|journey_sends|sequence_sends|privacy_requests|setup_invites|grant_library|grant_library_versions|portfolio_lists)$/,
  // BUILDER-3: who has an email open (a heartbeat), its comments, mentions and review links; the editor re-reads them itself.
  /^email_(editor_presence|comments|comment_mentions|review_links)$/,
  // SAFE-EDIT-1: a create's request key (server/shared/requestKey.js); the row it names is heard through its own table.
  /^request_keys$/,
];

// The topics a write to `table` reaches: [] for a silent table, ["other"] for
// one no rule names (heard only by the browser's kept lists).
function topicsOfTable(table) {
  const t = String(table || "").toLowerCase();
  if (SILENT.some(re => re.test(t))) return [];
  const rule = RULES.find(([re]) => re.test(t));
  return rule ? rule[1] : ["other"];
}

// The header's value for a set of tables: topics joined by commas, sorted, or
// "none" when nothing a screen shows was written.
function changedHeader(tables) {
  const topics = new Set();
  for (const t of tables || []) for (const k of topicsOfTable(t)) topics.add(k);
  return topics.size ? [...topics].sort().join(",") : "none";
}

module.exports = { topicsOfTable, changedHeader, RULES, SILENT };

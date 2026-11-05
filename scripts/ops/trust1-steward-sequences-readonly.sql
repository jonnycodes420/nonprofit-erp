-- scripts/ops/trust1-steward-sequences-readonly.sql · READ-ONLY. TRUST-1.
-- Every sequence Steward made on its own and left ON: the "At-Risk
-- Re-Engagement" and "Milestone & Anniversary Emails" sequences that
-- ensureAtRiskSequence / ensureMilestoneSequences inserted as 'active' (until
-- TRUST-1), in every org, by the hourly job or by ANY org's POST
-- /sequences/process. Nobody in that org turned them on. A row whose org has a
-- PATCH /sequences/<id>/status in the audit trail was touched by a person and
-- is shown with touched_by_person = true; the cleanup leaves those alone.
-- Org id, sequence id and counts only: no names, no addresses, no donor data.
BEGIN TRANSACTION READ ONLY;
SELECT s.org_id, s.id AS sequence_id, s.trigger, s.status, s.created_at,
       (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id = s.id)                       AS enrollments,
       (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id = s.id AND e.status='active') AS active_enrollments,
       (SELECT COUNT(*) FROM milestone_drafts m JOIN sequence_enrollments e ON e.id = m.sequence_enrollment_id
          WHERE e.sequence_id = s.id)                                                                    AS drafts_made,
       (SELECT COUNT(*) FROM milestone_drafts m JOIN sequence_enrollments e ON e.id = m.sequence_enrollment_id
          WHERE e.sequence_id = s.id AND m.status <> 'pending_review')                                   AS drafts_acted_on,
       EXISTS (SELECT 1 FROM fin_audit_log a WHERE a.org_id = s.org_id
                 AND a.request_path = '/sequences/' || s.id || '/status')                                AS touched_by_person
  FROM sequences s
 WHERE s.created_by = 'system:auto' AND s.trigger IN ('at_risk','milestone')
   AND s.status = 'active' AND s.turned_on_by IS NULL
 ORDER BY s.org_id, s.trigger;
ROLLBACK;

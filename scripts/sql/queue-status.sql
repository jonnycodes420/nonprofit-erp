-- scripts/sql/queue-status.sql · DEPLOY-1
--
-- READ-ONLY. Three SELECTs; they write nothing, lock nothing they keep, and are
-- safe to run twice. Jonathan runs it by hand against production (Supabase SQL
-- editor or psql, read-only role where possible). No build, script or suite
-- runs it against prod; it was checked only on fixtures in a scratch database.
-- It reads job_queue alone, so it runs the same before and after DEPLOY-1.
--
-- What it answers: what is waiting and running on the background queue
-- (jobQueue.js), and what is stuck.
--   1. waiting and running jobs grouped by type, org and age, with the oldest
--      of each group and how many waiting rows sit behind a running row of
--      their own key (a key runs one at a time, so those wait for it)
--   2. running jobs that look dead: no heartbeat for 10 minutes (the worker
--      beats every 30 s while it runs a job), or running past the one-hour
--      lease. These are what scripts/ops/queue-requeue.js gives back.
--   3. waiting jobs by type: a type here that no worker has a handler for
--      waits for ever before DEPLOY-1; queue-requeue.js names those
--
-- Ages are from run_after for waiting rows (when the job became due) and from
-- started_at for running ones. No payload is read: it can name a donor.

-- 1 · waiting and running, by type, org and age
SELECT j.status,
       j.name                                                     AS job_type,
       COALESCE(j.org_id, '(no org)')                             AS org_id,
       CASE WHEN age < INTERVAL '1 hour'  THEN '1 under an hour'
            WHEN age < INTERVAL '1 day'   THEN '2 an hour to a day'
            WHEN age < INTERVAL '7 days'  THEN '3 a day to a week'
            ELSE '4 over a week' END                              AS age_band,
       COUNT(*)                                                   AS jobs,
       MIN(j.since)                                               AS oldest_since,
       MAX(age)                                                   AS oldest_age,
       (ARRAY_AGG(j.id ORDER BY j.since))[1]                      AS oldest_id,
       COUNT(*) FILTER (WHERE j.status = 'waiting' AND EXISTS (
         SELECT 1 FROM job_queue r WHERE r.key = j.key AND r.status = 'running'))
                                                                  AS behind_a_running_row
  FROM (SELECT q.*, CASE WHEN q.status = 'waiting' THEN q.run_after ELSE COALESCE(q.started_at, q.created_at) END AS since,
               NOW() - CASE WHEN q.status = 'waiting' THEN q.run_after ELSE COALESCE(q.started_at, q.created_at) END AS age
          FROM job_queue q
         WHERE q.status IN ('waiting', 'running')) j
 GROUP BY j.status, j.name, COALESCE(j.org_id, '(no org)'), age_band
 ORDER BY j.status DESC, oldest_age DESC;

-- 2 · running jobs whose heartbeat or lease has run out
SELECT j.id,
       j.name                                                     AS job_type,
       COALESCE(j.org_id, '(no org)')                             AS org_id,
       j.attempts, j.max_attempts,
       j.locked_by                                                AS held_by,
       j.started_at,
       j.heartbeat_at,
       NOW() - COALESCE(j.heartbeat_at, j.started_at, j.created_at) AS silent_for,
       NOW() - COALESCE(j.started_at, j.created_at)               AS running_for,
       CASE WHEN COALESCE(j.heartbeat_at, j.started_at, j.created_at) < NOW() - INTERVAL '10 minutes'
            THEN 'no heartbeat for 10 minutes: its worker stopped'
            ELSE 'past its one-hour lease' END                    AS why,
       (SELECT COUNT(*) FROM job_queue w WHERE w.key = j.key AND w.status = 'waiting') AS waiting_behind_it
  FROM job_queue j
 WHERE j.status = 'running'
   AND (COALESCE(j.heartbeat_at, j.started_at, j.created_at) < NOW() - INTERVAL '10 minutes'
        OR COALESCE(j.started_at, j.created_at) < NOW() - INTERVAL '1 hour')
 ORDER BY j.started_at NULLS FIRST;

-- 3 · waiting jobs by type
SELECT j.name                                                     AS job_type,
       COUNT(*)                                                   AS waiting,
       COUNT(*) FILTER (WHERE j.run_after <= NOW())               AS due,
       MIN(j.run_after)                                           AS oldest_due_at,
       MAX(j.run_after)                                           AS latest_due_at
  FROM job_queue j
 WHERE j.status = 'waiting'
 GROUP BY j.name
 ORDER BY oldest_due_at;

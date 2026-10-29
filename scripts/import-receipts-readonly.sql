-- scripts/import-receipts-readonly.sql · READ-ONLY. Once check b of the nightly
-- check (removed): every import receipt foots against its gifts, to the cent.
-- Per org: the imports whose receipt (imports.gifts_created, dollars_created)
-- differs from the gifts that carry its import_id, plus any of those gifts
-- since deleted (deleted_records, unrestored). A reversed import is left out.
-- Org id and counts only: no names, no emails, no donor data.
BEGIN TRANSACTION READ ONLY;
SELECT i.org_id, COUNT(*)::int AS imports_off,
       SUM(COALESCE(i.gifts_created, 0) - COALESCE(g.n, 0) - COALESCE(t.n, 0))::int AS gifts_difference,
       SUM(ROUND(COALESCE(i.dollars_created, 0) * 100) - COALESCE(g.c, 0) - COALESCE(t.c, 0))::bigint AS cents_difference
  FROM imports i
  LEFT JOIN LATERAL (SELECT COUNT(*) AS n, SUM(ROUND(x.amount * 100)) AS c FROM gifts x
                      WHERE x.org_id = i.org_id AND x.import_id = i.id) g ON true
  LEFT JOIN LATERAL (SELECT COUNT(*) AS n, SUM(ROUND((r.row_data->>'amount')::numeric * 100)) AS c FROM deleted_records r
                      WHERE r.org_id = i.org_id AND r.table_name = 'gifts' AND r.restored_at IS NULL
                        AND r.row_data->>'import_id' = i.id) t ON true
 WHERE i.reversed_at IS NULL
   AND (COALESCE(i.gifts_created, 0) > 0 OR COALESCE(g.n, 0) > 0)
   AND (COALESCE(i.gifts_created, 0) <> COALESCE(g.n, 0) + COALESCE(t.n, 0)
        OR ROUND(COALESCE(i.dollars_created, 0) * 100) <> COALESCE(g.c, 0) + COALESCE(t.c, 0))
 GROUP BY i.org_id
 ORDER BY i.org_id;
ROLLBACK;

#!/usr/bin/env bash
# scripts/ci/semgrep-sql-gate.sh — REDTEAM-2: Semgrep's SQL rules, with NO baseline.
#
# Every JS SQL-injection rule in the four rulesets the main gate uses
# (semgrep-gate.sh), over all app code, every run. A finding fails CI unless it
# is listed, by file and line text, in scripts/ci/semgrep-sql-open.txt: the
# few hits still open, each with its reason. A listed hit that no longer shows
# fails too ("remove it"), so the list only shrinks. A new SQL hit anywhere
# fails, whatever file it is in and whatever commit it came from.
#
# One job (-j 1), never more: on 7 Nov 2026 a -j 8 scan of main reported 27 of
# the 39 SQL hits a -j 1 scan found (Semgrep 1.184.0 drops taint findings
# under parallel jobs), so a parallel gate would pass on hits it never saw.
# It takes about 20 s.
#
# The fix for a hit is the sql`` tag (server/db/sql.js), never a nosemgrep
# comment: a `nosemgrep` on a SQL rule fails this gate (--disable-nosem).
#
# Usage: bash scripts/ci/semgrep-sql-gate.sh   (needs `semgrep` on PATH, or SEMGREP=<path>)
set -euo pipefail
cd "$(dirname "$0")/../.."
SEMGREP="${SEMGREP:-semgrep}"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

RULES=(
  javascript.express.security.injection.tainted-sql-string.tainted-sql-string
  javascript.aws-lambda.security.tainted-sql-string.tainted-sql-string
  javascript.aws-lambda.security.pg-sqli.pg-sqli
  javascript.aws-lambda.security.knex-sqli.knex-sqli
  javascript.aws-lambda.security.mysql-sqli.mysql-sqli
  javascript.aws-lambda.security.sequelize-sqli.sequelize-sqli
  javascript.lang.security.audit.sqli.node-knex-sqli.node-knex-sqli
  ajinabraham.njsscan.database.sql_injection.node_sqli_injection
  ajinabraham.njsscan.database.sql_injection_knex.node_knex_sqli_injection
)
args=()
for r in "${RULES[@]}"; do args+=(--config "r/$r"); done

"$SEMGREP" scan --metrics=off --quiet --disable-nosem -j 1 --timeout 120 --timeout-threshold 0 \
  --exclude node_modules --exclude client --exclude tests --exclude scripts --exclude docs \
  --exclude .generated --exclude audit \
  "${args[@]}" --json -o "$OUT" .

node scripts/ci/semgrep-sql-check.js "$OUT" scripts/ci/semgrep-sql-open.txt

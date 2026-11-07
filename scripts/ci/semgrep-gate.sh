#!/usr/bin/env bash
# scripts/ci/semgrep-gate.sh — REDTEAM-1: Semgrep as a CI gate.
#
# Fails on any ERROR-severity finding from the JS/Node and OWASP rulesets in
# app code (tests, scripts, docs and the built client are not scanned).
#
# No file may be skipped for time: --timeout-threshold 0 and a long per-rule
# timeout, because the default 5 s timeout silently skipped 651 file/rule pairs
# on 6 Nov 2026 and a gate that passes on files it never read proves nothing.
#
# Excluded rules are the njsscan ones REDTEAM-1 read every hit of and found
# false in this codebase (each line in docs/history/REDTEAM-1.md says why):
# express_xss (every value goes through escapeHtml), express_open_redirect
# (fixed paths), node_secret / node_password (signing code and form copy),
# node_sqli_injection (the ?→$n placeholder helper), eval_nodejs (setTimeout
# with a number), generic_path_traversal (ids looked up in a bundled list).
# A single checked line elsewhere carries `// nosemgrep: <rule>` and a reason.
#
# A RATCHET, not a clean sheet. A full scan with a 60 s rule timeout found 24
# tainted-sql-string hits on main (dynamic WHERE builders whose pieces are
# fixed strings and whose values are bound, as far as REDTEAM-1 read them) that
# REDTEAM-1 did not have time to read one by one; they are the next build's
# list (docs/history/REDTEAM-1.md). With SEMGREP_BASELINE set to a commit,
# only a finding that is NEW since it fails, and only changed files are read.
#
# Usage: [SEMGREP_BASELINE=<sha>] bash scripts/ci/semgrep-gate.sh   (needs `semgrep` on PATH)
set -euo pipefail
cd "$(dirname "$0")/../.."

EXCLUDE_RULES=(
  ajinabraham.njsscan.xss.xss_node.express_xss
  ajinabraham.njsscan.redirect.open_redirect.express_open_redirect
  ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
  ajinabraham.njsscan.generic.hardcoded_secrets.node_password
  ajinabraham.njsscan.database.sql_injection.node_sqli_injection
  ajinabraham.njsscan.eval.eval_node.eval_nodejs
  ajinabraham.njsscan.traversal.path_traversal.generic_path_traversal
)
args=()
for r in "${EXCLUDE_RULES[@]}"; do args+=(--exclude-rule "$r"); done
if [ -n "${SEMGREP_BASELINE:-}" ]; then args+=(--baseline-commit "$SEMGREP_BASELINE"); fi

exec semgrep scan --metrics=off --error --severity ERROR \
  --timeout "${SEMGREP_TIMEOUT:-60}" --timeout-threshold 0 -j "${SEMGREP_JOBS:-4}" \
  --config p/javascript --config p/nodejsscan --config p/owasp-top-ten --config p/expressjs \
  --exclude node_modules --exclude client/dist --exclude tests --exclude scripts --exclude docs \
  --exclude .generated --exclude audit \
  "${args[@]}" .

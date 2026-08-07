# Post-deploy smoke — auth revocation (BUILD-37 + BUILD-38)

**Run these by hand against prod after deploying. Do NOT run them against a real
org's account** — register a throwaway org, and delete it at the end. These were
NOT executed from the audit environment (no prod privilege tests, per the RoE).

Backend: `https://nonprofit-erp-production.up.railway.app`
DB changes (demote/delete) are done in the **Supabase SQL editor**.

Set a shell var:
```bash
API=https://nonprofit-erp-production.up.railway.app
```

## 0. Create a throwaway org and capture its token + user id
```bash
EMAIL="smoke+$(date +%s)@example.com"
REG=$(curl -s -X POST $API/auth/register-org -H 'Content-Type: application/json' \
  -d "{\"orgName\":\"SMOKE — DELETE ME\",\"userName\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"smoke12345\"}")
echo "$REG"
TOKEN=$(echo "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
UID=$(echo "$REG"   | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["id"])')
ORG=$(echo "$REG"   | python3 -c 'import sys,json;print(json.load(sys.stdin)["org"]["id"])')
echo "UID=$UID ORG=$ORG"
```

## 1. BUILD-37 — a demoted admin's pre-demotion token loses admin (expect 403)
Baseline (expect **200**):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/auth/invite \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"nobody+1@example.com","role":"staff"}'
```
Demote in Supabase, then replay the **same** token (expect **403**):
```sql
-- Supabase SQL editor:
UPDATE users SET role='staff' WHERE id='<paste UID>';
```
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/auth/invite \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"nobody+2@example.com","role":"admin"}'
# expect: 403
```

## 2. BUILD-38 — a deleted user's token loses ALL access (expect 401)
> Only meaningful once BUILD-38 (`sessions_valid_after` + revocation-aware
> `requireAuth`) is deployed. Prod cache TTL is 30s, so wait up to ~30s after the
> delete if the token was used in the last half-minute.

Delete the user in Supabase, then use the same token on a plain read route:
```sql
-- Supabase SQL editor:
DELETE FROM users WHERE id='<paste UID>';
```
```bash
sleep 31
curl -s -o /dev/null -w "%{http_code}\n" $API/donors -H "Authorization: Bearer $TOKEN"
# expect: 401   (error: user_not_found)
```

## 3. Cleanup — remove the throwaway org (leave no residue)
Preferred: a super-admin deletes it via the audited cascade route:
```bash
# as a super-admin token (SUPER=<super-admin JWT>):
curl -s -X DELETE $API/admin/orgs/$ORG -H "Authorization: Bearer $SUPER"
```
Or directly in Supabase (the user row may already be gone from step 2):
```sql
DELETE FROM invites WHERE org_id='<paste ORG>';
DELETE FROM workflows WHERE org_id='<paste ORG>';
DELETE FROM users WHERE org_id='<paste ORG>';
DELETE FROM orgs WHERE id='<paste ORG>';
```
Confirm it's gone:
```bash
curl -s -o /dev/null -w "%{http_code}\n" $API/donors -H "Authorization: Bearer $TOKEN"  # 401
```

## Pass criteria
- Step 1: 200 → **403** after demotion.
- Step 2: **401** (`user_not_found`) after deletion.
- Step 3: throwaway org fully removed.

# SCALE-1 load harness: the server env for the load cluster. Source it, never
# point it anywhere but localhost. Stand-ins answer every provider on :6718,
# the mail sink on :6702, the AI stand-in on :6719.
export DB_SSL=disable
export LOAD_PG_PORT="${LOAD_PG_PORT:-5546}"
export DATABASE_URL="${LOAD_DATABASE_URL:-postgresql://steward@localhost:${LOAD_PG_PORT}/steward_scale1}"
export JWT_SECRET=local-test-secret PORT="${PORT:-6701}" SESSION_CACHE_TTL_MS="${SESSION_CACHE_TTL_MS:-30000}"
export RESEND_API_KEY=re_dummy_local RESEND_BASE_URL=http://localhost:6702 DEMO_SMTP_FROM=noreply@stewardapp.dev
export STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest STRIPE_API_BASE=http://localhost:6718/stripe
export STRIPE_BILLING_SECRET_KEY=sk_test_dummy STRIPE_BILLING_API_BASE=http://localhost:6718/stripe
export INTUIT_API_BASE=http://localhost:6718/intuit XERO_API_BASE=http://localhost:6718/xero
export GOOGLE_CALENDAR_API_BASE=http://localhost:6718 GMAIL_API_BASE=http://localhost:6718 GRAPH_API_BASE=http://localhost:6718
export MAILCHIMP_API_BASE=http://localhost:6718/mailchimp/3.0 GIVEBUTTER_API_BASE=http://localhost:6718/givebutter/v1
export ZEFFY_API_BASE=http://localhost:6718/zeffy/api/v1 SQUARE_API_BASE=http://localhost:6718/square/v2
export CONSTANT_CONTACT_API_BASE=http://localhost:6718/constantcontact/v3
export ANTHROPIC_API_KEY=sk-ant-load-standin ANTHROPIC_BASE_URL=http://localhost:6719
export STEWARD_CREDENTIAL_KEY=local-scratch-credential-key-0123456789
export DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1 FOUNDER_EMAIL=jonathan@stewardapp.dev
export MIGC_CONTACT_EMAIL=migc-contact@example.org MIGC_EMAIL_FROM=noreply@stewardapp.dev

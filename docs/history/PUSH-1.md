## PUSH-1 · Gmail and Outlook updates arrive in seconds, not minutes (2026-10-11)

Google and Microsoft now tell Steward the moment a mailbox or calendar changes, and the FIX-34 5-minute read
became the safety net. Three endpoints on the API host: `POST /push/google/gmail` (Cloud Pub/Sub push for a Gmail
watch, verified by the Google-signed OIDC token), `POST /push/google/calendar` (a Calendar watch channel, verified by
channel id, resource id and a per-channel secret) and `POST /push/microsoft` (Graph change and lifecycle
notifications, verified by subscription id and clientState; it also echoes Graph's validationToken). A verified
notice runs the connection's normal incremental read with trigger `push`; a notice that lands mid-read waits and
retries instead of being dropped. Google Calendar's "anything new?" moved to the incremental sync token
(`gcal_sync_token`, series not instances, so the first token never expands a weekly meeting). The tick keeps every
channel alive (`mailboxPush.ensurePush`), reads every 30 minutes while push is on and every 5 when it is not, and
pauses push when a 30-minute read finds a change no notice announced. The health panel shows "Instant updates: on"
with the last notice, or the paused sentence. Off until `PUSH_BASE_URL` (and, for Gmail, the Pub/Sub topic and
service account) are set. One new suite, `push1-instant` (44 checks; four planted defects each seen red).

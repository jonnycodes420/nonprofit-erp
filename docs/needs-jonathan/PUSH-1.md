## 0-PUSH-1 · INSTANT GMAIL, CALENDAR AND OUTLOOK UPDATES (2026-10-11)

Until these are set, push stays off and the 5-minute read carries on exactly as before. In order:

1. **Google Cloud, the project that holds the Gmail OAuth client:** APIs & Services, enable **Cloud Pub/Sub API**.
2. Pub/Sub, Topics, **Create topic** `steward-gmail-push` (no default subscription). Note its full name `projects/<project-id>/topics/steward-gmail-push`.
3. On that topic, Permissions, **Add principal** `gmail-api-push@system.gserviceaccount.com` with role **Pub/Sub Publisher**. (If the org policy "Domain restricted sharing" blocks it, allow that one account.)
4. IAM, Service accounts, **Create** `steward-gmail-push` (no roles needed). Then grant the Pub/Sub service agent `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com` the role **Service Account Token Creator** on that new account.
5. Pub/Sub, Subscriptions, **Create subscription** on the topic: delivery **Push**, endpoint `https://nonprofit-erp-production.up.railway.app/push/google/gmail`, tick **Enable authentication**, service account `steward-gmail-push@<project-id>.iam.gserviceaccount.com`, audience `https://nonprofit-erp-production.up.railway.app/push/google/gmail`, acknowledgement deadline 60s, retry with exponential backoff.
6. Railway (API service) variables: `PUSH_BASE_URL=https://nonprofit-erp-production.up.railway.app`, `GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/steward-gmail-push`, `PUBSUB_PUSH_SERVICE_ACCOUNT=steward-gmail-push@<project-id>.iam.gserviceaccount.com`. Leave `PUBSUB_PUSH_AUDIENCE` unset (it defaults to the endpoint above). Redeploy.
7. **Microsoft:** nothing to register. Graph notification URLs are not part of the Azure app registration; Graph checks the URL itself when Steward subscribes. The existing Mail.Read and Calendars.ReadWrite consents cover it.
8. **Google Calendar:** nothing beyond step 6 (it uses `PUSH_BASE_URL`). If Google ever answers a channel with "Unauthorized WebHook callback channel", verify the API domain in Search Console.
9. Check: within 5 minutes of the redeploy, Settings, Connections shows "Instant updates: on" under each connected mailbox.

## SALES-1 · the sales CRM in /ops (2026-11-11)

1. **Import your real HubSpot export yourself, on prod.** /ops → Sales → Import: Companies first, then Contacts, then Deals (HubSpot's standard export columns map themselves). Each import can be undone from the same panel. No build touches your real file.
2. **Connect your sales mailbox** (jonathan@stewardapp.dev, Microsoft 365): /ops → Sales → Sales settings → Mailbox → Connect. It uses the same Microsoft app and redirect as the org mailboxes, so nothing new is set up. Only mail with your sales contacts (or a prospect domain you list) is stored.

# Steward app for Zapier

Built with the Zapier Platform CLI (`zapier-platform` 19.1.0, `zapier-platform-core` 19.1.0, exact pin required by the CLI). Nothing here touches the Steward server: every call goes through the public API at `/api/v1`, authenticated with a scoped API key in the `x-api-key` header.

## What it does

Triggers (polling, newest-first, deduped by id):

- **New Gift** (`triggers/newGift.js`) - GET `/api/v1/gifts`. Needs `read:gifts`.
- **New Person** (`triggers/newPerson.js`) - GET `/api/v1/people`. Needs `read:people`.
- **Stage Changed** (`triggers/stageChanged.js`) - GET `/api/v1/people`, deduped on person-plus-stage, so a stage change fires once. Needs `read:people`. Limitation, stated honestly in the code: the people list is newest-first by when the record was added, so stage changes on records far down the list only surface if the trigger pages deep enough. Stage changes on recently added people are caught reliably. A server-side "recently updated" ordering, or API-key-usable webhook subscriptions, would remove this.

Actions:

- **Create Person** (`creates/createPerson.js`) - POST `/api/v1/people`. Matched on email inside the org: an existing person is updated, never duplicated. Needs `write:people`.
- **Record Gift** (`creates/recordGift.js`) - POST `/api/v1/gifts`. Written through the one gift path (`recordGift`), so funds, rollups, receipts and thank-you follow-ups behave exactly as in the app. An idempotency key is generated per Zap run when the input is left blank, so a retry never records the gift twice. Needs `write:gifts`.
- **Add Note** (`creates/addNote.js`) - POST `/api/v1/notes`. Adds a call, meeting, email or note; it cannot change giving. Needs `write:notes`.

Auth (`authentication.js`): paste a Steward API key (made in Steward under Settings, API keys, with exactly the permissions the Zap needs), plus the API host, defaulting to `https://nonprofit-erp-production.up.railway.app`. The connection check calls GET `/api/v1/me`, which needs no scope. `stewardapp.dev` does NOT serve the API (no `/api/v1` rewrite in `vercel.json`), so the Railway host is the right default.

A legacy `read` key expands to every read scope and no write scope, so the two read triggers work with old keys and no old key gains write power.

## Scopes needed per piece

| Piece          | Scope needed   |
| -------------- | -------------- |
| New Gift       | `read:gifts`   |
| New Person     | `read:people`  |
| Stage Changed  | `read:people`  |
| Create Person  | `write:people` |
| Record Gift    | `write:gifts`  |
| Add Note       | `write:notes`  |
| Connection test| none           |

## Not built, and why

- **Task Due trigger.** BUILD-98 scoped it, but the public API has no tasks endpoint and no task scopes (`/api/v1` is people, gifts, notes, and `/me`). It needs a server-side addition: a tasks route under `/api/v1` plus `read:tasks` scope.
- **Instant (REST hook) triggers.** Steward emits signed webhooks (`gift.created`, `person.created`, `person.updated`, ...), but webhook subscriptions can only be created by a logged-in admin at `/webhooks`, not by an API key. REST hooks are not possible until webhook endpoints can be provisioned with a key.

## Develop

```bash
cd zapier
npm install
node node_modules/zapier-platform-cli/src/bin/run validate
npm test
```

One test file (`test/auth-and-triggers.js`, all HTTP mocked with nock): connection check plus scope read, gift list order and dedupe, stage-change dedupe, gift recording with an idempotency key. No real server, no real key, no production data.

## Push later (not done: no Zapier developer account exists yet)

```bash
cd zapier
node node_modules/zapier-platform-cli/src/bin/run login
node node_modules/zapier-platform-cli/src/bin/run register "Steward"
node node_modules/zapier-platform-cli/src/bin/run push
```

Then invite users from the Zapier developer dashboard and submit for review. Zapier's app review asks for a privacy policy URL: ship `/privacy` on the marketing site first (the draft was delivered 2026-10-01 and awaits copy review).

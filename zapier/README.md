# Steward app for Zapier

Built with the Zapier Platform CLI (`zapier-platform` 19.1.0, `zapier-platform-core` 19.1.0, exact pin required by the CLI). Nothing here touches the Steward server: every call goes through the public API at `/api/v1`, authenticated with a scoped API key in the `x-api-key` header.

## What it does

Triggers (polling, newest-first, deduped by id):

- **New Gift** (`triggers/newGift.js`) - GET `/api/v1/gifts`. Needs `read:gifts`.
- **New Person** (`triggers/newPerson.js`) - GET `/api/v1/people`. Needs `read:people`.
- **Person List** (`triggers/personList.js`) - hidden. Not a trigger anybody picks: it is the dropdown behind the Person field on Record Gift and Add Note, so an id does not have to be looked up by hand. Needs `read:people`, which a write-only key does not have, so a 403 there is caught and answered with the two ways out.
- **Fund List** (`triggers/fundList.js`) - hidden. The dropdown behind the Fund field on Record Gift. GET `/api/v1/funds` (id and name, this org only). Needs `read:funds`; a 403 is caught and answered with the same two ways out as Person List.
- **Stage Changed** (`triggers/stageChanged.js`) - GET `/api/v1/people`, deduped on person-plus-stage, so a stage change fires once. Needs `read:people`. Limitation, stated honestly in the code: the people list is newest-first by when the record was added, so stage changes on records far down the list only surface if the trigger pages deep enough. Stage changes on recently added people are caught reliably. A server-side "recently updated" ordering, or API-key-usable webhook subscriptions, would remove this.

Actions:

- **Create Person** (`creates/createPerson.js`) - POST `/api/v1/people`. Matched on email inside the org: an existing person is updated, never duplicated. Needs `write:people`.
- **Record Gift** (`creates/recordGift.js`) - POST `/api/v1/gifts`. Written through the one gift path (`recordGift`), so funds, rollups, receipts and thank-you follow-ups behave exactly as in the app. An idempotency key is generated per Zap run when the input is left blank, so a retry never records the gift twice. Needs `write:gifts`.
- **Add Note** (`creates/addNote.js`) - POST `/api/v1/notes`. Adds a call, meeting, email or note; it cannot change giving. Needs `write:notes`.

The API host is fixed (`lib/api.js`, `API_BASE_URL` = `https://nonprofit-erp-production.up.railway.app`). Nobody self-hosts Steward, so there is no host field for anybody to type into (FIX-13, which is what clears D026). `stewardapp.dev` does NOT serve the API (no `/api/v1` rewrite in `vercel.json`), so the Railway host is the API host. `assertSafeHost` still guards the fixed host: https only, a real dotted hostname, never a loopback, private, link-local or cloud-metadata address.

Auth (`authentication.js`): paste a Steward API key (made in Steward under Settings, API keys, with exactly the permissions the Zap needs). The connection check calls GET `/api/v1/me`, which needs no scope.

A legacy `read` key expands to every read scope and no write scope, so the two read triggers work with old keys and no old key gains write power.

## Scopes needed per piece

| Piece          | Scope needed   |
| -------------- | -------------- |
| New Gift       | `read:gifts`   |
| New Person     | `read:people`  |
| Stage Changed  | `read:people`  |
| Create Person  | `write:people` |
| Record Gift    | `write:gifts` (`read:funds` for the Fund dropdown, `read:people` for the Person dropdown) |
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

One test file (`test/auth-and-triggers.js`, all HTTP mocked with nock): connection check plus scope read, gift list order and dedupe, stage-change dedupe, gift recording with an idempotency key, the fixed host, and the people and fund dropdowns' scope errors. No real server, no real key, no production data.

## Pushed

Registered and pushed 2026-10-01 under `jonathan@stewardapp.dev` as **Steward** (app `247112`, slug `App247112`), public audience, CRM category, version 1.0.0. `.zapierapprc` is committed: it holds the integration id, not a credential, and committing it is what lets `zapier-platform push` work from any clone. The deploy key lives in `~/.zapierrc` and is never in the repo.

```bash
cd zapier
npm install
npx zapier-platform-cli validate
npm test
npx zapier-platform-cli push
```

## Still open before the App Directory

`validate` passes structurally with no failures. What is left is not code:

- **Logo (M004).** A square PNG, 256x256 or larger, uploaded in the Developer Platform UI. The CLI cannot upload one.
- **A connected account (A001), 3 users with live Zaps (S001), one live Zap per trigger and action (S002), and a successful task for each (T001-T005).** Real Zaps against a real Steward org, not something the CLI can fake. Invite link: `npx zapier-platform-cli users:links`.
- **Marketing description (M002).** Zapier wants the listing description to start with "Steward is a". Set in the Developer Platform UI.
- D004 (fund dropdown) and D026 (host field) were cleared in 1.0.1 (FIX-13): `GET /api/v1/funds` with a `read:funds` scope backs a Fund dropdown, and the host field is gone.

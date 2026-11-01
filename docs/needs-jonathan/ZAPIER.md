## 0-ZAPIER · THE APP IS PUSHED. FOUR THINGS ARE YOURS (2026-10-01)

Registered and pushed under `jonathan@stewardapp.dev`: **Steward**, app `247112`,
public audience, CRM category, version 1.0.0. `zapier-platform validate` has no
failures. What is left cannot be done from the CLI.

1. **Upload the logo.** Zapier wants a square PNG of at least 256x256 and the
   CLI cannot upload one. `client/public/android-chrome-512x512.png` is exactly
   right: 512x512, the cream S on ink. Developer Platform → the Steward
   integration → Manage → Branding.

2. **Say who gets the test invite.** The link below adds somebody to version
   1.0.0 without an email from us, so it can go in a message you send yourself:

       https://zapier.com/developer/public-invite/247112/514791/c29bca6ff6a02d168cfd8642e87685ea/

   To send Zapier's own invitation email instead, name the addresses and it is
   `npx zapier-platform-cli users:add <email>` from `zapier/`. Nobody has been
   emailed.

3. **Three users with live Zaps, and one live Zap per piece.** The App Directory
   will not take it without them (checks S001, S002, A001, T001-T005): three
   people other than you, each with a Zap that has run at least once, covering
   all three triggers and all three actions. That needs real Steward orgs with
   API keys, so it is a customer ask, not a code one.

4. **Two decisions, both warnings rather than blockers.**
   · **A fund dropdown** (D004) needs `GET /api/v1/funds` and a `read:funds`
     scope on the server. Today `fundId` is typed by hand, because the gifts
     endpoint returns a fund's name and not its id. Worth it, or leave it?
   · **The API host field** (D026) is what lets a self-hosted Steward connect.
     It is validated now (https only, no loopback, private, link-local or
     metadata address), but the check fires on the field existing at all. It
     clears for real only by deleting the field and pinning everyone to
     production. Does anybody self-host?

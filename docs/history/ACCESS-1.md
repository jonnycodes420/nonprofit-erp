# ACCESS-1 · A view-only role, and an org switcher for people in more than one org

From Muse's Walk B: Settings → Team had no view-only role, though boards, auditors and part-time help need
one, and someone in two orgs (a consultant; Jonathan with a demo and a test org) had to sign out to move
between them.

What changed, and why it is built this way:
- **The viewer is decided in the one door.** `requireAuth` (auth.js) already decided the volunteer
  coordinator's scope there (VOL-1); the viewer is beside it. Writes are refused by METHOD, not by a list
  of write routes: anything but GET/HEAD/OPTIONS answers 403 `view_only` with one sentence, unless
  `shared/viewOnly.js` names it (her own account and session, Ask, Why, the help assistant, a report run,
  Atlas's question, the switch, joining another org). A write route added tomorrow is refused tomorrow.
  Team (`/org/team`, invites, users), billing (all but `/billing/status`, which the app's chrome reads on
  every page) and connections are refused even as reads. An export (`export` in the path, or `.csv`) is
  refused only when the org's admin turned `orgs.viewer_exports_off` on (Settings → Team, "Viewers can
  export", on by default).
- **The app reads the same file.** `client/src/lib/viewOnly.js` stops a viewer's write before it leaves
  the browser (apiFetch) with the server's own sentence, and disables the buttons that change something
  (by their words, with the tooltip "View-only access"), except inside `data-viewer-ok` (her own account
  pages, the account menu, the switcher). The top bar says "View only". This is a courtesy; the server is
  the guard.
- **Atlas** keeps only its read steps (`question`, `find`, `about`) for a viewer and says once why the
  rest were left out, before any draft starts. Its own request row (`voice_memos`) is still written, as it
  is for everyone, so the answer can be shown; nothing about a donor is.
- **One person, several orgs.** `users` keeps one row per person (email is unique across Steward), so the
  home org stays `users.org_id` with `users.role`, and each further org is a row in `org_memberships`
  (additive) with its own role. The token always named an org (`orgId`); `requireAuth` used to overwrite
  it with the home org. Now, when the token's org is not home, the membership row decides the org and the
  role, live on every request, so ending a membership ends that org's session at once.
  `server/auth/access.js` `liveRoleIn` is the one place a role is read for an org; `requireAdmin`,
  mail types, Room to give (`prospect.canSee`) and `/me` read it, not the home row. The places that
  re-sign a token (password change, two-step) keep the session's org.
- **The switch** (`server/org/switchOrg.js`, POST /auth/switch-org) issues a new session for the target
  org and signs the old one out, so the old org's token can't be replayed. The app writes the new session
  and reloads into Home, so no screen keeps a list from the org she left. It is exempt from the
  org-changed check (HARDEN-1), being the deliberate change.
- **A super-admin into a customer's org** (any `org_kind` but demo, internal_test or fixture, and an org
  with no kind set counts as a customer's) needs a reason of at least 8 characters. The audit row is the
  target org's own (`req.audit.forOrg`), with the reason in its sentence, so the customer sees it in their
  Activity. When she isn't a member it opens FIX-57's read-only support session (the reason is kept on
  `support_sessions.reason`), so the org's "support access off" still holds.
- **Joining a second org.** An admin can now invite an address that has an account elsewhere. The invitee
  accepts **signed in** as that account; a password typed on the public invite page would have been a way
  to guess passwords around sign-in's limits and two-step code, so it is refused. Team lists such a member
  with "joined from another org"; Remove ends the membership, never her own account.

Tests: `tests/access1-roles.test.js` (one new suite, it guards security). It boots the server in-process
and walks the live router: every write route answers a viewer 403 `view_only` unless the suite's own
hand-written list names it; reads and exports; Atlas (with a control that the same words DO write for an
admin); Team and billing; a two-org user's every param-less read before and after the switch, scanned for
the other org's markers; a super-admin's reason and its audit row; joining a second org.

Not done here, for the next build: the user pickers outside Team (assign to, task owner) read
`users.org_id`, so a member from another org is not offered there yet; why.js's Room to give in
`talkedAnswer` still asks the home role; a member can't be made an admin of the org they joined (no
role-change control exists for anyone yet).
